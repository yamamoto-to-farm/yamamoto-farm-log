// schedule/seed/seedList-save.js

import { getRows, makeEmptyRow } from "./seedList-state.js";
import { renderTable } from "./seedList-render.js";
import { saveLog } from "../../common/save/index.js";

/* ---------------------------------------------------------
   デバッグ切り替え（localStorage）
   localStorage.setItem("debugSeedListSave", "1") → ON
   localStorage.removeItem("debugSeedListSave") → OFF
--------------------------------------------------------- */
function isDebug() {
  return localStorage.getItem("debugSeedListSave") === "1";
}

function dbg(...args) {
  if (isDebug()) console.log("[seedList-save]", ...args);
}

/* ===============================
   1. 入力済み行だけ抽出
=============================== */
function extractFilledRows() {
  const rows = getRows();
  dbg("rows:", rows);

  const filled = rows.filter(r =>
    r.planSowDate ||
    r.variety ||
    r.trayCount > 0 ||
    r.trayType ||
    r.planArea ||
    r.daysToPlant > 0 ||
    r.planPlantDate ||
    r.harvestPlanYM ||
    r.source
  );

  dbg("filled rows:", filled);
  return filled;
}

/* ===============================
   2. CSV（ヘッダなし）に変換
=============================== */
function convertToCsvLines(rows) {
  const csv = rows
    .map(r => [
      r.planSowDate || "",
      r.variety || "",
      r.cropType || "",
      r.trayCount || 0,
      r.trayType || "",
      r.planArea || "",
      r.daysToPlant || 0,
      r.planPlantDate || "",
      r.harvestPlanYM || "",
      r.source || ""
    ]
    .map(v => `"${String(v).replace(/"/g, '""')}"`)
    .join(","))
    .join("\n");

  dbg("csvLines:\n" + csv);
  return csv;
}

/* ===============================
   3. 入力フォームをクリア
=============================== */
function clearForm() {
  dbg("clearForm()");
  const rows = getRows();
  rows.length = 0;

  for (let i = 0; i < 12; i++) {
    rows.push(makeEmptyRow());
  }

  renderTable();
}

/* ===============================
   4. メイン処理（saveLog append）
=============================== */
export async function saveSeedList() {
  dbg("=== saveSeedList START ===");

  const filled = extractFilledRows();
  if (filled.length === 0) {
    alert("入力されている行がありません。");
    dbg("no filled rows → abort");
    return;
  }

  const csvLines = convertToCsvLines(filled);

  try {
    dbg("calling saveLog append…");

    await saveLog(
      "schedule-seed",   // logs/schedule-seed/
      "all",             // all.csv
      {},                // JSON なし
      csvLines,          // append 内容
      ""                 // replaceCsv 空 → append モード
    );

    dbg("saveLog completed");

    clearForm();
    alert("播種計画を保存しました（logs/schedule-seed/all.csv に追記）");

  } catch (e) {
    console.error("❌ saveSeedList error:", e);
    alert("保存に失敗しました（Console を確認してください）");
  }

  dbg("=== saveSeedList END ===");
}
