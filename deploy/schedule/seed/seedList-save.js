// schedule/seed/seedList-save.js

import { getRows, makeEmptyRow } from "./seedList-state.js";
import { renderTable } from "./seedList-render.js";

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
   2. CSV 文字列に変換
=============================== */
function convertToCsv(rows) {
  const header = [
    "planSowDate",
    "variety",
    "cropType",
    "trayCount",
    "trayType",
    "planArea",
    "daysToPlant",
    "planPlantDate",
    "harvestPlanYM",
    "source"
  ].join(",");

  const lines = rows.map(r => [
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
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));

  return header + "\n" + lines.join("\n");
}

/* ===============================
   3. CSV をダウンロード（append 方式）
=============================== */
function downloadCsvAppend(csvText) {
  const blob = new Blob([csvText], { type: "text/csv" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "seedList_append.csv"; // append 用
  a.click();

  URL.revokeObjectURL(url);
}

/* ===============================
   4. 入力フォームをクリア
=============================== */
function clearForm() {
  const rows = getRows();
  rows.length = 0;

  // 12 行の空行を再生成
  for (let i = 0; i < 12; i++) {
    rows.push(makeEmptyRow());
  }

  renderTable();
}

/* ===============================
   5. メイン処理
=============================== */
export function saveSeedList() {
  const filled = extractFilledRows();
  if (filled.length === 0) {
    alert("入力されている行がありません。");
    return;
  }

  const csv = convertToCsv(filled);

  // CSV を append 用としてダウンロード
  downloadCsvAppend(csv);

  // 入力フォームをクリア
  clearForm();

  alert("CSV に追加しました（append 用ファイルをダウンロードしました）");
}
