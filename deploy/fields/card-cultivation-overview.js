// fields/card-cultivation-overview.js
import { safeFieldName } from "/common/utils.js";

const CF_BASE = "https://d3sscxnlo0qnhe.cloudfront.net";

export async function renderCultivationOverviewCard({ fieldName, startDate, endDate }) {
  const safeField = safeFieldName(fieldName || "");
  if (!safeField || !endDate) {
    return "";
  }

  const rangeStartLabel = startDate || "前作なし（全期間）";

  const [pesticideLog, intertillLog, fertilizerLog] = await Promise.all([
    loadFieldLog("pesticide", safeField),
    loadFieldLog("intertill", safeField),
    loadFieldLog("fertilizer", safeField)
  ]);

  const pesticideCount = countEntriesInRange(pesticideLog, startDate, endDate, () => true);
  const intertillCount = countEntriesInRange(intertillLog, startDate, endDate, () => true);
  const topdressCount = countEntriesInRange(
    fertilizerLog,
    startDate,
    endDate,
    entry => !entry.sourceWork
  );

  const q = new URLSearchParams({
    field: fieldName,
    start: startDate,
    end: endDate,
    type: "all"
  }).toString();

  const qPesticide = new URLSearchParams({
    field: fieldName,
    start: startDate,
    end: endDate,
    type: "pesticide"
  }).toString();

  const qFertilizer = new URLSearchParams({
    field: fieldName,
    start: startDate,
    end: endDate,
    type: "fertilizer"
  }).toString();

  const qIntertill = new URLSearchParams({
    field: fieldName,
    start: startDate,
    end: endDate,
    type: "intertill"
  }).toString();

  return `
    <h2 class="section-title">栽培概要</h2>
    <div class="info-block">
      <div class="info-line">集計期間：${escapeHtml(rangeStartLabel)} ～ ${escapeHtml(endDate)}</div>
      <div class="info-line">防除回数：${pesticideCount} 回</div>
      <div class="info-line">中耕回数：${intertillCount} 回</div>
      <div class="info-line">施肥（追肥）回数：${topdressCount} 回</div>

      <div class="info-line link">
        ↳ <a href="/fields/work-logs.html?${qPesticide}">防除記録を見る</a>
      </div>
      <div class="info-line link">
        ↳ <a href="/fields/work-logs.html?${qFertilizer}">施肥記録を見る</a>
      </div>
      <div class="info-line link">
        ↳ <a href="/fields/work-logs.html?${qIntertill}">中耕記録を見る</a>
      </div>
      <div class="info-line link">
        ↳ <a href="/fields/work-logs.html?${q}">作業記録をまとめて見る</a>
      </div>
    </div>
  `;
}

async function loadFieldLog(type, fieldName) {
  const path = `${CF_BASE}/logs/${type}/${encodeURIComponent(fieldName)}.json?ts=${Date.now()}`;

  try {
    const res = await fetch(path);
    if (!res.ok) return { years: {} };

    const data = await res.json();
    if (!data || typeof data !== "object") return { years: {} };
    if (!data.years || typeof data.years !== "object") return { years: {} };
    return data;
  } catch {
    return { years: {} };
  }
}

function countEntriesInRange(logData, startDate, endDate, predicate) {
  const start = startDate ? toDate(startDate) : null;
  const end = toDate(endDate);
  if (!end) return 0;

  let count = 0;
  const years = logData?.years || {};

  for (const year of Object.keys(years)) {
    const entries = years[year]?.entries;
    if (!Array.isArray(entries)) continue;

    entries.forEach(entry => {
      const d = toDate(entry?.date);
      if (!d) return;
      if (start && d < start) return;
      if (d > end) return;
      if (!predicate(entry || {})) return;
      count += 1;
    });
  }

  return count;
}

function toDate(dateText) {
  if (!dateText || typeof dateText !== "string") return null;
  const d = new Date(dateText);
  if (Number.isNaN(d.getTime())) return null;

  // 日単位比較に揃える
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
