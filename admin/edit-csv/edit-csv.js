// admin/edit-csv/edit-csv.js

import { loadCSV } from "./loader.js";
import { renderCsvTable } from "./table.js";
import { attachEditor, addRow } from "./editor.js";
import { saveCsvFile } from "./saver.js";

console.log("=== admin/edit-csv/edit-csv.js loaded ===");

let currentRows = null;   // editor.js が管理する rows
let currentType = "";
let currentFile = "";

// CSV 読み込み
document.getElementById("loadCsvBtn").addEventListener("click", async () => {
  currentType = document.getElementById("csvType").value;
  currentFile = document.getElementById("csvFile").value;

  const url = `../../logs/${currentType}/${currentFile}`;
  console.log("[admin] CSV 読み込み:", url);

  const rows = await loadCSV(url);

  // テーブル描画
  renderCsvTable(rows);

  // 編集ロジックを紐づける
  const table = document.querySelector("#csvTableArea table");
  currentRows = attachEditor(table);

  console.log("✔ editor attached. rows:", currentRows);
});

// 行追加
document.getElementById("addRowBtn").addEventListener("click", () => {
  if (!currentRows) {
    alert("先に CSV を読み込んでください");
    return;
  }

  // ヘッダー取得
  const table = document.querySelector("#csvTableArea table");
  const headerCells = table.querySelectorAll("thead th");
  const headers = Array.from(headerCells).slice(1).map(th => th.textContent);

  // 行追加
  addRow(currentRows, headers);

  // 再描画
  renderCsvTable(currentRows);

  // 編集ロジックを再度紐づける
  const newTable = document.querySelector("#csvTableArea table");
  currentRows = attachEditor(newTable);
});

// CSV 保存（全書き換え）
document.getElementById("saveCsvBtn").addEventListener("click", async () => {
  if (!currentType || !currentFile) {
    alert("先に CSV を読み込んでください");
    return;
  }

  await saveCsvFile(currentType, currentFile);
});