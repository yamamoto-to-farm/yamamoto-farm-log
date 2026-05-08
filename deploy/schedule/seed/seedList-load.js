// seedList-load.js
// 播種計画の読み込み（CSV / JSON）
// 年度ごと CSV：logs/schedule/seed/{year}.csv
// annual.json：logs/schedule/annual/annual.json

import { getRows, makeEmptyRow, setSeedRowsFromAnnual } from "./seedList-state.js";
import { renderTable } from "./seedList-render.js";

/* ============================================================
   デバッグモード
============================================================ */
const DEBUG = false;
const log = (...args) => DEBUG && console.log("[seedList-load]", ...args);

/* ============================================================
   現在の年度を取得
============================================================ */
export function getCurrentYear() {
  const sel = document.getElementById("yearSelect");
  if (sel && sel.value) {
    log("getCurrentYear → yearSelect:", sel.value);
    return sel.value;
  }
  const y = String(new Date().getFullYear());
  log("getCurrentYear → fallback:", y);
  return y;
}

/* ============================================================
   読み込みメッセージ表示関数
============================================================ */
function showSeedListMessage(msg) {
  const area = document.getElementById("summaryArea");
  if (area) {
    area.innerHTML = `<div style="
      padding:6px 10px;
      margin-bottom:8px;
      background:#eef7ff;
      border-left:4px solid #3182ce;
      font-size:14px;
    ">${msg}</div>`;
  }
  log(msg);
}

/* ============================================================
   CSV パース（PapaParse 版）
============================================================ */
function parseSeedListCsv(csvText) {
  log("parseSeedListCsv: start");

  const parsed = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  if (!parsed.data || parsed.data.length === 0) {
    log("parseSeedListCsv: no rows");
    return [];
  }

  const rows = parsed.data.map(src => {
    const row = makeEmptyRow();

    row.planSowDate   = src.sowDate || "";
    row.variety       = src.variety || "";

    row.trayCountRaw  = src.trayCount || "";
    row.trayCount     = Number(row.trayCountRaw) || 0;
    row.trayType      = src.trayType || "";

    row.spacingRow    = Number(src.spacingRow || 34);
    row.spacingBed    = Number(src.spacingBed || 60);

    row.planAreaPlan  = src.planAreaPlan || "";
    row.planAreaCalc  = src.planAreaCalc || "";

    row.daysToPlantRaw = src.daysToPlant || "";
    row.daysToPlant    = Number(row.daysToPlantRaw) || 0;

    row.planPlantDate  = src.planPlantDate || "";

    row.harvestMonth   = src.harvestMonth || "";
    row.harvestPlanYM  = src.harvestPlanYM || "";
    row.harvestWeek    = src.harvestWeek || "";

    row.source         = src.source || "";
    row.memo           = src.memo || "";

    return row;
  });

  log("parseSeedListCsv: parsed rows =", rows.length);
  return rows;
}

/* ============================================================
   年度ごとの CSV を読み込む
============================================================ */
export async function loadSeedListFromCSV(year) {
  const path = `/logs/schedule/seed/${year}.csv`;
  log("loadSeedListFromCSV:", path);

  try {
    const res = await fetch(path, { cache: "no-store" });
    log("CSV fetch status:", res.status);

    if (!res.ok) {
      log("CSV not found → fallback to JSON");
      return false;
    }

    const text = await res.text();
    const parsed = parseSeedListCsv(text);

    const rows = getRows();
    rows.length = 0;
    parsed.forEach(r => rows.push(r));

    log("CSV loaded. rows =", rows.length);
    renderTable();
    return true;

  } catch (e) {
    console.error("loadSeedListFromCSV error", e);
    return false;
  }
}

/* ============================================================
   annual.json → rows 初期生成（plan.js 互換）
============================================================ */
export async function loadSeedListFromJSON(year) {
  const path = `/logs/schedule/annual/annual.json`;
  log("loadSeedListFromJSON:", path);

  try {
    const res = await fetch(path, { cache: "no-store" });
    log("JSON fetch status:", res.status);

    if (!res.ok) {
      console.error("annual.json not found", res.status);
      return;
    }

    const data = await res.json();
    log("annual.json loaded keys:", Object.keys(data));

    const yearBlock = data[year];
    if (!yearBlock) {
      console.error("annual.json: year block not found", year);
      return;
    }

    let step2rows = [];

    if (Array.isArray(yearBlock.seedList)) {
      step2rows = yearBlock.seedList;
      log("detected: seedList");
    }
    else if (Array.isArray(yearBlock.sowPlan)) {
      step2rows = yearBlock.sowPlan;
      log("detected: sowPlan");
    }
    else if (yearBlock.step2?.rows) {
      step2rows = yearBlock.step2.rows;
      log("detected: step2.rows");
    }
    else {
      console.error("annual.json: no valid step2 rows found");
      return;
    }

    log("step2 rows:", step2rows.length);

    await setSeedRowsFromAnnual(step2rows);
    renderTable();

    log("JSON load complete");

  } catch (e) {
    console.error("loadSeedListFromJSON error", e);
  }
}

/* ============================================================
   初期ロード：CSV 優先 → JSON
============================================================ */
export async function initSeedList() {
  const year = getCurrentYear();
  log("initSeedList: year =", year);

  const ok = await loadSeedListFromCSV(year);
  if (ok) {
    showSeedListMessage(`📄 CSV（${year}.csv）を読み込みました`);
    log("initSeedList: loaded from CSV");
    return;
  }

  await loadSeedListFromJSON(year);

  const rows = getRows();
  if (rows.length > 0) {
    showSeedListMessage(`📘 annual.json（${year}）から読み込みました`);
    log("initSeedList: loaded from JSON");
  } else {
    showSeedListMessage(`⚠ ${year} のデータがありません（CSV も JSON も空）`);
    log("initSeedList: no data in CSV or JSON");
    renderTable();
  }

  log("initSeedList: done");
}
