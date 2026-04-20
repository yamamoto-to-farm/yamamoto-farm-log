// card-summary.js（CloudFront 統一版）
import { safeFieldName } from "/common/utils.js";
import { loadNotesForPlantingRef } from "./notes.js";

// ★ 指標計算 & 育苗概要ロジック
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

  if (!index[fieldName]) {
    return `<p>サマリーがありません</p>`;
  }

  // ★ 目標値（harvestBase.json）
  const harvestBase = await fetch(`${CF_BASE}/data/harvestBase.json?ts=${Date.now()}`)
    .then(r => r.json())
    .catch(() => ({ monthly: {} }));

  let html = "";

  for (const year of Object.keys(index[fieldName]).sort()) {
    html += `
      <details>
        <summary>${year} 年</summary>
        <div class="year-block">
    `;

    const files = index[fieldName][year];

    for (const file of files) {
      const url = `${CF_BASE}/logs/summary/${fieldName}/${year}/${file}?ts=${Date.now()}`;
      const summary = await fetch(url).then(r => r.json());

      html += await renderSummaryCard(summary, harvestBase);
    }

    html += `</div></details>`;
  }

  return html;
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
async function renderSummaryCard(s, harvestBase) {

  /* -------------------------------
     ★ 育苗概要
  --------------------------------*/
  const seedRef = s.planting.seedRef;
  const seedlingSummary = getSeedlingSummary(seedRef, s.planting.plantDate);

  /* -------------------------------
     日付処理
  --------------------------------*/
  const hasHarvest = !!s.harvest.firstDate && !!s.harvest.lastDate && s.harvest.count > 0;

  const daysToHarvest = hasHarvest
    ? calcDaysToHarvest(s.planting.plantDate, s.harvest.firstDate)
    : "—";

  /* -------------------------------
     面積計算
  --------------------------------*/
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

  /* -------------------------------
     指標計算
  --------------------------------*/
  const yieldPerTan = hasHarvest
    ? calcYieldPerTan(totalWeight, areaTan)
    : "—";

  const unitsPerTan = hasHarvest
    ? calcUnitsPerTan(totalAmount, areaTan)
    : "—";

  const avgPerUnit = hasHarvest
    ? calcAvgWeight(totalWeight, totalAmount)
    : "—";

  /* -------------------------------
     目標反収
  --------------------------------*/
  const ym = s.planting.harvestPlanYM;
  const month = ym?.slice(5);

  const targetPerTan = month && harvestBase.monthly[month]
    ? harvestBase.monthly[month].yieldPerTan
    : null;

  const achieveRate =
    hasHarvest && targetPerTan
      ? ((yieldPerTan / targetPerTan) * 100).toFixed(1)
      : "—";

  const rateClass = getRateClass(achieveRate);

  /* -------------------------------
     収穫期間
  --------------------------------*/
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

  /* -------------------------------
     ★ 現場メモ
  --------------------------------*/
  const notes = await loadNotesForPlantingRef(s.plantingRef);

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

  /* -------------------------------
     ★ 栽培管理概要（空）
  --------------------------------*/
  const fertSummary = {};
  const pestSummary = {};
  const workSummary = {};

  /* -------------------------------
     HTML 出力
  --------------------------------*/
  return `
    <div class="card">

      <!-- ★ OS 標準の h2 に統一 -->
      <h2 class="section-title">
        作付け別・定植〜出荷データ（${s.planting.plantDate.slice(0,4)}年）
      </h2>

      <div class="info-block">
        <div class="info-block-title">【定植情報】</div>
        <div class="info-line">品種：${s.planting.variety}</div>
        <div class="info-line">定植日：${s.planting.plantDate}</div>
        <div class="info-line">定植株数：${s.planting.quantity} 株（セルトレイ：${s.planting.trayType || "-"}穴）</div>
        <div class="info-line">株間 × 条間：${spacingText}</div>
        <div class="info-line">作付け面積：${areaTan.toFixed(2)} 反（${areaM2.toFixed(1)} ㎡）</div>
      </div>

      <div class="info-block">
        <div class="info-block-title">【収穫情報】</div>
        <div class="info-line">収穫期間：${harvestPeriod}</div>
        <div class="info-line">収穫回数：${s.harvest.count} 回</div>
        <div class="info-line">収穫合計：${totalAmount} 基（${totalWeight.toFixed(1)} kg）</div>
        <div class="info-line">定植 → 初回収穫：${daysToHarvest} 日</div>
      </div>

      <div class="info-block">
        <div class="info-block-title">【育苗概要】</div>
        <div class="info-line">
          播種：${seedlingSummary.sowDate || "—"}　
          育苗期間：${seedlingSummary.days || "—"}日
        </div>
        <div class="info-line link">
          ↳ <a href="/seedling/detail.html?seedRef=${seedRef || ""}">育苗記録を見る</a>
        </div>
      </div>

      <div class="info-block">
        <div class="info-block-title">【栽培管理概要】</div>

        <div class="info-line">
          施肥：${fertSummary.count || 0}回
          （最終 ${fertSummary.lastDate || "—"}）
        </div>

        <div class="info-line">
          防除：${pestSummary.count || 0}回
          （最終 ${pestSummary.lastDate || "—"}）
        </div>

        <div class="info-line">
          その他作業：${workSummary.count || 0}回
        </div>

        <div class="info-line link">
          ↳ <a href="/work/detail.html?plantingRef=${s.plantingRef}">栽培管理記録を見る</a>
        </div>
      </div>

      <div class="info-block">
        <div class="info-block-title">【分析指標】</div>

        <div class="info-line">
          反当たり収量：${yieldPerTan} kg/反　
          ${unitsPerTan} 基/反
        </div>

        <div class="info-line">1基あたり平均重量：${avgPerUnit} kg/基</div>
      </div>

      <div class="info-block">
        <div class="info-block-title">【目標比較】</div>
        <div class="info-line">目標反収：${targetPerTan ? targetPerTan + " kg/反" : "—"}</div>
        <div class="info-line">
          達成率：
          <span class="${rateClass}">
            ${achieveRate !== "—" ? achieveRate + "%" : "—"}
          </span>
        </div>
      </div>

      ${notesHTML}

      <div class="info-line" style="font-size:12px; color:#666;">
        最終更新：${updatedJST}
      </div>

    </div>
  `;
}