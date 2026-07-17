// admin/edit-csv/edit-csv.js

import { loadCSV } from "./loader.js";
import { renderCsvTable } from "./table.js";
import { attachEditor, addRow, deleteRow, getSelectedRowIndex, sortRows } from "./editor.js";
import { saveCsvFile } from "./saver.js";

console.log("=== admin/edit-csv/edit-csv.js loaded ===");

let currentRows = null;
let currentType = "";
let currentFile = "";
let sortState = {};

const csvTypeEl = document.getElementById("csvType");
const csvFileEl = document.getElementById("csvFile");

function buildYearCsvList() {
  const base = new Date().getFullYear();
  return [`${base - 1}.csv`, `${base}.csv`, `${base + 1}.csv`];
}

function getCsvFileOptionsByType(type) {
  if (type === "schedule/seed" || type === "schedule/planting") {
    return buildYearCsvList();
  }
  return ["all.csv"];
}

function refreshCsvFileOptions(type) {
  const options = getCsvFileOptionsByType(type);
  const prev = csvFileEl.value;

  csvFileEl.innerHTML = "";
  options.forEach(file => {
    const option = document.createElement("option");
    option.value = file;
    option.textContent = file;
    csvFileEl.appendChild(option);
  });

  if (options.includes(prev)) {
    csvFileEl.value = prev;
  }
}

csvTypeEl.addEventListener("change", () => {
  refreshCsvFileOptions(csvTypeEl.value);
});

refreshCsvFileOptions(csvTypeEl.value);

// CSV 読み込み
document.getElementById("loadCsvBtn").addEventListener("click", async () => {
  currentType = csvTypeEl.value;
  currentFile = csvFileEl.value;

  console.log("[admin] CSV 読み込み:", currentType, currentFile);

  // ★ 正しい呼び出し（URL を渡さない）
  const rows = await loadCSV(currentType, currentFile);

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

  const table = document.querySelector("#csvTableArea table");
  const headerCells = table.querySelectorAll("thead th");
  const headers = Array.from(headerCells).slice(1).map(th => th.textContent);

  addRow(currentRows, headers);

  renderCsvTable(currentRows);

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

  deleteRow(currentRows, index);

  renderCsvTable(currentRows);

  const newTable = document.querySelector("#csvTableArea table");
  currentRows = attachEditor(newTable);
});

// 列名クリックでソート
document.getElementById("csvTableArea").addEventListener("click", e => {
  if (e.target.tagName !== "TH") return;

  const key = e.target.dataset.key;
  if (!key) return;

  sortState[key] = !sortState[key];

  sortRows(currentRows, key, sortState[key]);

  renderCsvTable(currentRows);

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
