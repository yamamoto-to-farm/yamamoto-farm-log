// card-summary.js（style.css の h2.section-title に完全対応版）
import { safeFieldName, safeFileName } from "/common/utils.js";
import { loadCSV } from "/common/csv.js";
import { loadNotesForPlantingRef } from "./notes.js";
import { renderCultivationOverviewCard } from "./card-cultivation-overview.js";

import {
  calcAreaM2,
  calcAreaTan,
  calcYieldPerTan,
  calcUnitsPerTan,
  calcAvgWeight,
  calcDaysToHarvest,
  getSeedlingSummary
} from "./analysis-utils.js";

const CF_BASE = "https://d3sscxnlo0qnhe.cloudfront.net";

/* ===============================
   メインエントリ：カード生成
=============================== */
export async function renderSummaryCards(rawFieldName) {
  const fieldName = safeFieldName(rawFieldName);

  const index = await fetch(`${CF_BASE}/data/summary-index.json?ts=${Date.now()}`)
    .then(r => r.json())
    .catch(() => ({}));

  const summarySources = await resolveSummarySources({ index, rawFieldName, fieldName });

  if (!summarySources.length) {
    return `<p>サマリーがありません</p>`;
  }

  const harvestBase = await fetch(`${CF_BASE}/data/harvestBase.json?ts=${Date.now()}`)
    .then(r => r.json())
    .catch(() => ({ monthly: {} }));

  const tillageDates = await loadTillageDates(fieldName);

  const allItems = (
    await Promise.all(
      summarySources.map(async (source) => {
        const { fieldKey, year, file } = source;
        try {
          const url = `${CF_BASE}/logs/summary/${fieldKey}/${year}/${file}?ts=${Date.now()}`;
          const summary = await fetch(url).then(r => r.json());
          return { year: String(year), summary };
        } catch {
          return null;
        }
      })
    )
  ).filter(Boolean);

  allItems.sort((a, b) => {
    const da = String(a?.summary?.planting?.plantDate || "");
    const db = String(b?.summary?.planting?.plantDate || "");
    return da.localeCompare(db);
  });

  let prevHarvestLastDate = "";
  allItems.forEach((item, idx) => {
    const cur = item.summary;
    const next = allItems[idx + 1]?.summary;

    cur.__prevHarvestLastDate = prevHarvestLastDate;
    cur.__nextPlantDate = normalizeDate(next?.planting?.plantDate || "");
    cur.__nextPrepStartDate = findNextPrepStartDate(
      tillageDates,
      normalizeDate(cur?.planting?.plantDate || ""),
      normalizeDate(next?.planting?.plantDate || "")
    );

    if (cur?.harvest?.lastDate) {
      prevHarvestLastDate = String(cur.harvest.lastDate);
    }
  });

  const grouped = {};
  allItems.forEach(item => {
    if (!grouped[item.year]) grouped[item.year] = [];
    grouped[item.year].push(item.summary);
  });

  let html = "";

  for (const year of Object.keys(grouped).sort()) {
    const cardsHtml = await Promise.all(
      grouped[year].map(summary => renderSummaryCard(summary, harvestBase, fieldName))
    );

    html += `
      <details>
        <summary>${year} 年</summary>
        <div class="year-block">
    `;

    html += cardsHtml.join("");

    html += `</div></details>`;
  }

  return html;
}

async function resolveSummarySources({ index, rawFieldName, fieldName }) {
  const direct = buildSummarySourcesForField(index, fieldName);
  if (direct.length) return direct;

  const plantingRows = await loadCSV("/logs/planting/all.csv").catch(() => []);
  const targetFiles = new Set(
    plantingRows
      .filter(row => normalizeText(row?.field) === normalizeText(rawFieldName))
      .map(row => `${safeFileName(row?.plantingRef || "")}.json`)
      .filter(v => v !== ".json")
  );

  if (targetFiles.size === 0) return [];

  const fallback = [];
  Object.keys(index || {}).forEach(fieldKey => {
    const byYear = index?.[fieldKey] || {};
    Object.keys(byYear).forEach(year => {
      const files = Array.isArray(byYear[year]) ? byYear[year] : [];
      files.forEach(file => {
        if (targetFiles.has(String(file || ""))) {
          fallback.push({ fieldKey, year: String(year), file: String(file) });
        }
      });
    });
  });

  return fallback;
}

function buildSummarySourcesForField(index, fieldKey) {
  const byYear = index?.[fieldKey] || {};
  const sources = [];

  Object.keys(byYear)
    .sort()
    .forEach(year => {
      const files = Array.isArray(byYear[year]) ? byYear[year] : [];
      files.forEach(file => {
        sources.push({ fieldKey, year: String(year), file: String(file) });
      });
    });

  return sources;
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .trim();
}

/* ===============================
   達成率の色クラス判定
=============================== */
function getRateClass(rate) {
  if (rate === "—") return "";
  const r = Number(rate);
  if (r >= 100) return "rate-good";
  if (r >= 80) return "rate-ok";
  return "rate-bad";
}

/* ===============================
   summary.json → カードHTML
=============================== */
async function renderSummaryCard(s, harvestBase, fieldName) {

  const seedRef = s.planting.seedRef;
  const seedlingSummary = getSeedlingSummary(seedRef, s.planting.plantDate);

  const hasHarvest =
    !!s.harvest.firstDate &&
    !!s.harvest.lastDate &&
    s.harvest.count > 0;

  const daysToHarvest = hasHarvest
    ? calcDaysToHarvest(s.planting.plantDate, s.harvest.firstDate)
    : "—";

  const areaM2 = calcAreaM2(
    s.planting.quantity,
    s.planting.spacing.row,
    s.planting.spacing.bed
  );

  const areaTan = calcAreaTan(areaM2);
  const spacingText = `${s.planting.spacing.row}cm × ${s.planting.spacing.bed}cm`;

  const updatedJST = new Date(s.lastUpdated).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo"
  });

  const totalAmount = s.harvest.totalAmount;
  const totalWeight = s.shipping.totalWeight;

  const yieldPerTan = hasHarvest
    ? calcYieldPerTan(totalWeight, areaTan)
    : "—";

  const unitsPerTan = hasHarvest
    ? calcUnitsPerTan(totalAmount, areaTan)
    : "—";

  const avgPerUnit = hasHarvest
    ? calcAvgWeight(totalWeight, totalAmount)
    : "—";

  const ym = s.planting.harvestPlanYM;
  const month = ym?.slice(5);

  const targetPerTan =
    month && harvestBase.monthly[month]
      ? harvestBase.monthly[month].yieldPerTan
      : null;

  const achieveRate =
    hasHarvest && targetPerTan
      ? ((yieldPerTan / targetPerTan) * 100).toFixed(1)
      : "—";

  const rateClass = getRateClass(achieveRate);

  let harvestPeriod = "未収穫";

  if (hasHarvest) {
    const firstMD = s.harvest.firstDate.slice(5).replace("-", "/");
    const lastMD = s.harvest.lastDate.slice(5).replace("-", "/");

    const harvestDays =
      Math.floor(
        (new Date(s.harvest.lastDate) - new Date(s.harvest.firstDate))
        / (1000 * 60 * 60 * 24)
      ) + 1;

    harvestPeriod =
      firstMD === lastMD
        ? `${firstMD}（1日）`
        : `${firstMD} ～ ${lastMD}（${harvestDays}日）`;
  }

  const cultivationStart = getCultivationStartDate(
    s.planting.plantDate,
    s.__prevHarvestLastDate
  );
  const plantDate = normalizeDate(s.planting.plantDate || "");

  const today = new Date().toISOString().slice(0, 10);
  let cultivationEnd = hasHarvest
    ? s.harvest.lastDate
    : today;

  // 未収穫でも次作準備の最初の耕うんがある場合は、その前日で打ち切る
  if (!hasHarvest && s.__nextPrepStartDate) {
    const beforePrep = addDays(s.__nextPrepStartDate, -1);
    if (beforePrep && (!plantDate || beforePrep >= plantDate)) {
      cultivationEnd = beforePrep < today ? beforePrep : today;
    }
  }

  // 未収穫でも次作定植日がある場合は、次作開始の前日で打ち切る
  if (!hasHarvest && s.__nextPlantDate) {
    const beforeNextPlant = addDays(s.__nextPlantDate, -1);
    if (beforeNextPlant && (!plantDate || beforeNextPlant >= plantDate)) {
      cultivationEnd = beforeNextPlant < today ? beforeNextPlant : today;
    }
  }

  // 期間逆転を防ぐ（未収穫で候補日が誤検出された場合の保険）
  if (!hasHarvest && plantDate && cultivationEnd < plantDate) {
    cultivationEnd = today;
  }

  const [notes, cultivationOverviewHTML] = await Promise.all([
    loadNotesForPlantingRef(s.plantingRef),
    renderCultivationOverviewCard({
      fieldName,
      startDate: cultivationStart,
      endDate: cultivationEnd
    })
  ]);

  const notesHTML =
    notes.length > 0
      ? `
      <details class="notes-toggle">
        <summary>【現場メモ】（${notes.length}件）</summary>
        <ul class="notes-list">
          ${notes.map(n => `<li>${n}</li>`).join("")}
        </ul>
      </details>
      `
      : "";

  return `
    <div class="card year-summary-card">
      <div class="year-summary-grid">
        <section class="year-summary-section">
          <h2 class="section-title year-summary-title">定植情報</h2>
          <div class="info-block year-summary-block">
        <div class="info-line">
          品種：<a href="/varieties/index.html?variety=${encodeURIComponent(s.planting.variety)}">
          ${s.planting.variety}
          </a>
        </div>
        <div class="info-line">定植日：${s.planting.plantDate}</div>
        <div class="info-line">定植株数：${s.planting.quantity} 株（セルトレイ：${s.planting.trayType || "-"}穴）</div>
        <div class="info-line">株間 × 条間：${spacingText}</div>
        <div class="info-line">作付け面積：${areaTan.toFixed(2)} 反（${areaM2.toFixed(1)} ㎡）</div>
          </div>
        </section>

        <section class="year-summary-section">
          <h2 class="section-title year-summary-title">収穫情報</h2>
          <div class="info-block year-summary-block">
        <div class="info-line">収穫期間：${harvestPeriod}</div>
        <div class="info-line">収穫回数：${s.harvest.count} 回</div>
        <div class="info-line">収穫合計：${totalAmount} 基（${totalWeight.toFixed(1)} kg）</div>
        <div class="info-line">定植 → 初回収穫：${daysToHarvest} 日</div>
          </div>
        </section>

        <section class="year-summary-section">
          <h2 class="section-title year-summary-title">育苗概要</h2>
          <div class="info-block year-summary-block">
        <div class="info-line">
          播種：${seedlingSummary.sowDate || "—"}　
          育苗期間：${seedlingSummary.days || "—"}日
        </div>
        <div class="info-line link">
          ↳ <a href="/seedling/detail.html?seedRef=${seedRef || ""}">育苗記録を見る</a>
        </div>
          </div>
        </section>

        <section class="year-summary-section">
          ${cultivationOverviewHTML}
        </section>

        <section class="year-summary-section">
          <h2 class="section-title year-summary-title">分析指標</h2>
          <div class="info-block year-summary-block">
        <div class="info-line">
          反当たり収量：${yieldPerTan} kg/反　
          ${unitsPerTan} 基/反
        </div>
        <div class="info-line">1基あたり平均重量：${avgPerUnit} kg/基</div>
          </div>
        </section>

        <section class="year-summary-section">
          <h2 class="section-title year-summary-title">目標比較</h2>
          <div class="info-block year-summary-block">
        <div class="info-line">目標反収：${targetPerTan ? targetPerTan + " kg/反" : "—"}</div>
        <div class="info-line">
          達成率：
          <span class="${rateClass}">
            ${achieveRate !== "—" ? achieveRate + "%" : "—"}
          </span>
        </div>
          </div>
        </section>
      </div>

      ${notesHTML}

      <div class="info-line year-summary-updated">
        最終更新：${updatedJST}
      </div>

    </div>
  `;
}

function getCultivationStartDate(plantDate, prevHarvestLastDate) {
  const plant = normalizeDate(plantDate);
  const prev = normalizeDate(prevHarvestLastDate);

  if (!plant) return "";
  // 前作が無い場合は、今作準備として過去分をすべて含める
  if (!prev) return "";

  const nextDay = addDays(prev, 1);
  if (!nextDay) return plant;

  // 前作収穫翌日が定植日を超える場合は、従来どおり定植日開始にする
  return nextDay <= plant ? nextDay : plant;
}

function normalizeDate(value) {
  const text = String(value || "").trim();
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function addDays(dateText, days) {
  const d = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + days);

  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

async function loadTillageDates(fieldName) {
  const path = `${CF_BASE}/logs/tillage/${encodeURIComponent(fieldName)}.json?ts=${Date.now()}`;

  try {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) return [];

    const data = await res.json();
    const years = data?.years || {};
    const out = [];

    Object.keys(years).forEach(y => {
      const entries = years[y]?.entries;
      if (!Array.isArray(entries)) return;

      entries.forEach(e => {
        const d = normalizeDate(e?.date || "");
        if (d) out.push(d);
      });
    });

    return Array.from(new Set(out)).sort();
  } catch {
    return [];
  }
}

function findNextPrepStartDate(tillageDates, plantDate, nextPlantDate) {
  if (!Array.isArray(tillageDates) || tillageDates.length === 0) return "";
  if (!plantDate) return "";

  // 現作定植日より後で、次作定植日が分かる場合はその前までを候補にする
  for (const d of tillageDates) {
    if (d <= plantDate) continue;
    if (nextPlantDate && d >= nextPlantDate) continue;
    return d;
  }

  return "";
}
