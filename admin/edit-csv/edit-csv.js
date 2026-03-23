// admin/edit-csv/edit-csv.js

import { loadCSV } from "./loader.js";
import { renderCsvTable } from "./table.js";
import { attachEditor, addRow, deleteRow, getSelectedRowIndex, sortRows } from "./editor.js";
import { saveCsvFile } from "./saver.js";

console.log("=== admin/edit-csv/edit-csv.js loaded ===");

let currentRows = null;   // editor.js が管理する rows
let currentType = "";
let currentFile = "";
let sortState = {};       // 列ごとの昇順/降順を記録

// CSV 読み込み
document.getElementById("loadCsvBtn").addEventListener("click", async () => {
  currentType = document.getElementById("csvType").value;
  currentFile = document.getElementById("csvFile").value;

  // ★ GitHub の静的ファイルではなく S3 の最新 CSV を読む
  const url = `https://yamamoto-farm-log.s3.ap-northeast-1.amazonaws.com/logs/${currentType}/${currentFile}`;
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

// 行削除
document.getElementById("deleteRowBtn").addEventListener("click", () => {
  if (!currentRows) {
    alert("先に CSV を読み込んでください");
    return;
  }

  const index = getSelectedRowIndex();
  if (index === null) {
    alert("削除する行番号をクリックしてください");
    return;
  }

  // 行削除
  deleteRow(currentRows, index);

  // 再描画
  renderCsvTable(currentRows);

  // 編集ロジックを再度紐づける
  const newTable = document.querySelector("#csvTableArea table");
  currentRows = attachEditor(newTable);
});

// 列名クリックでソート
document.getElementById("csvTableArea").addEventListener("click", e => {
  if (e.target.tagName !== "TH") return;

  const key = e.target.dataset.key;
  if (!key) return; // "#" の列は無視

  // 昇順/降順トグル
  sortState[key] = !sortState[key];

  // ソート実行
  sortRows(currentRows, key, sortState[key]);

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