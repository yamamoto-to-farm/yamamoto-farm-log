// seedList-load.js
// 播種計画の読み込み（CSV / JSON）
// 年度ごと CSV：logs/schedule-seed/{year}.csv
// annual.json：logs/schedule/annual/annual.json

import { getRows, makeEmptyRow, setSeedRowsFromAnnual } from "./seedList-state.js";
import { renderTable } from "./seedList-render.js";

/**
 * 現在の年度を取得
 * - 年度セレクトがあればそこから
 * - なければ今年の西暦
 */
export function getCurrentYear() {
  const sel = document.getElementById("yearSelect");
  if (sel && sel.value) {
    return sel.value;
  }
  return String(new Date().getFullYear());
}

/**
 * CSV → rows に復元
 * 新フォーマット（この OS 専用）：
 * header:
 * sowDate,variety,trayCount,trayType,spacingRow,spacingBed,planAreaPlan,planAreaCalc,daysToPlant,planPlantDate,harvestMonth,harvestPlanYM,harvestWeek,source,memo
 */
function parseSeedListCsv(csvText) {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length <= 1) return [];

  const header = lines[0].split(",");
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = line.split(",");

    const row = makeEmptyRow();

    const get = name => {
      const idx = header.indexOf(name);
      if (idx === -1) return "";
      return cols[idx] ?? "";
    };

    row.planSowDate   = get("sowDate");
    row.variety       = get("variety");
    row.trayCountRaw  = get("trayCount");
    row.trayCount     = Number(row.trayCountRaw) || 0;
    row.trayType      = get("trayType");

    row.spacingRow    = Number(get("spacingRow")) || 34;
    row.spacingBed    = Number(get("spacingBed")) || 60;

    row.planAreaPlan  = get("planAreaPlan");
    row.planAreaCalc  = get("planAreaCalc");

    row.daysToPlantRaw = get("daysToPlant");
    row.daysToPlant    = Number(row.daysToPlantRaw) || 0;
    row.planPlantDate  = get("planPlantDate");

    row.harvestMonth   = get("harvestMonth");
    row.harvestPlanYM  = get("harvestPlanYM");
    row.harvestWeek    = get("harvestWeek");

    row.source         = get("source");
    row.memo           = get("memo");

    rows.push(row);
  }

  return rows;
}

/**
 * 年度ごとの CSV を読み込む
 * - あればそれを rows にセット
 * - なければ false を返す（呼び出し側で JSON にフォールバック）
 */
export async function loadSeedListFromCSV(year) {
  const path = `/logs/schedule-seed/${year}.csv`;

  try {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) {
      // 404 など → CSV なし
      return false;
    }

    const text = await res.text();
    const parsed = parseSeedListCsv(text);

    const rows = getRows();
    rows.length = 0;
    parsed.forEach(r => rows.push(r));

    renderTable();
    return true;
  } catch (e) {
    console.error("loadSeedListFromCSV error", e);
    return false;
  }
}

/**
 * annual.json から指定年度の STEP2 結果を読み込み、
 * setSeedRowsFromAnnual() で rows を初期生成する。
 *
 * annual.json の構造は OS 側に合わせてここを調整してほしい。
 * 例：
 * {
 *   "2026": {
 *     "seedList": [ { sowDate, plantDate, month, variety, needArea, harvestWeek }, ... ]
 *   }
 * }
 */
export async function loadSeedListFromJSON(year) {
  const path = `/logs/schedule/annual/annual.json`;

  try {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) {
      console.error("annual.json not found", res.status);
      return;
    }

    const data = await res.json();

    // ★★★ ここは OS の annual.json の実際の構造に合わせて調整 ★★★
    // 例として data[year].seedList を想定
    const yearBlock = data[year];
    if (!yearBlock) {
      console.error("annual.json: year block not found", year);
      return;
    }

    const step2rows = yearBlock.seedList || yearBlock.sowPlan || [];
    // sowDate, plantDate, month, variety, needArea, harvestWeek を持つ配列を想定

    await setSeedRowsFromAnnual(step2rows);
    renderTable();
  } catch (e) {
    console.error("loadSeedListFromJSON error", e);
  }
}

/**
 * 初期ロード：CSV 優先 → なければ JSON
 */
export async function initSeedList() {
  const year = getCurrentYear();

  const ok = await loadSeedListFromCSV(year);
  if (!ok) {
    await loadSeedListFromJSON(year);
  }
}
