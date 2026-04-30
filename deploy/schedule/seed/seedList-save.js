// schedule/seed/seedList-save.js

import { getRows, makeEmptyRow } from "./seedList-state.js";
import { renderTable } from "./seedList-render.js";
import { saveLog } from "../../common/save/index.js";

/* ===============================
   1. 入力済み行だけ抽出
=============================== */
function extractFilledRows() {
  const rows = getRows();

  return rows.filter(r =>
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
}

/* ===============================
   2. CSV（ヘッダなし）に変換
=============================== */
function convertToCsvLines(rows) {
  return rows
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
}

/* ===============================
   3. 入力フォームをクリア
=============================== */
function clearForm() {
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
  const filled = extractFilledRows();
  if (filled.length === 0) {
    alert("入力されている行がありません。");
    return;
  }

  const csvLines = convertToCsvLines(filled);

  try {
    await saveLog(
      "schedule-seed",   // logs/schedule-seed/
      "all",             // all.csv
      {},                // JSON なし
      csvLines,          // append 内容
      ""                 // replaceCsv 空 → append モード
    );

    clearForm();
    alert("播種計画を保存しました（logs/schedule-seed/all.csv に追記）");

  } catch (e) {
    console.error("❌ saveSeedList error:", e);
    alert("保存に失敗しました（Console を確認してください）");
  }
}
