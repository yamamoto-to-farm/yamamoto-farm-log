// admin/edit-csv/edit-csv.js

import { loadCSV } from "./loader.js";
import { renderCsvTable } from "./table.js";
import { attachEditor, addRow, deleteRow, getSelectedRowIndex, sortRows } from "./editor.js";
import { saveCsvFile, restoreCsvFromBackup } from "./saver.js";

console.log("=== admin/edit-csv/edit-csv.js loaded ===");

let currentRows = null;
let currentType = "";
let currentFile = "";
let sortState = {};
let originalRows = [];

function cloneRows(rows) {
  return (Array.isArray(rows) ? rows : []).map(row => ({ ...row }));
}

const csvTypeEl = document.getElementById("csvType");
const csvFileEl = document.getElementById("csvFile");
const csvSearchInput = document.getElementById("csvSearchInput");
const csvSearchResult = document.getElementById("csvSearchResult");
const csvSearchResults = document.getElementById("csvSearchResults");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderCsvSearchResults(matches) {
  if (!csvSearchResults) return;
  if (!matches.length) {
    csvSearchResults.innerHTML = "";
    return;
  }

  csvSearchResults.innerHTML = matches.map(({ row, index }) => {
    const content = Array.from(row.querySelectorAll("td"))
      .slice(1)
      .map(cell => cell.textContent.trim())
      .filter(Boolean)
      .join(" / ") || "（内容なし）";
    return `<button type="button" class="csv-search-result-item" data-search-row="${index}">
      <span class="csv-search-result-row">${index + 1}行目</span>
      <span class="csv-search-result-content">${escapeHtml(content)}</span>
    </button>`;
  }).join("");
}

function applyCsvSearch({ scrollToFirst = true } = {}) {
  const table = document.querySelector("#csvTableArea table");
  if (!table) {
    if (csvSearchResult) csvSearchResult.textContent = "CSVを読み込んでください";
    return;
  }

  const query = String(csvSearchInput?.value || "").trim().toLocaleLowerCase();
  const rows = Array.from(table.querySelectorAll("tbody tr"));
  rows.forEach(row => {
    row.classList.remove("search-match", "search-current");
  });

  if (!query) {
    if (csvSearchResult) csvSearchResult.textContent = "";
    renderCsvSearchResults([]);
    return;
  }

  const matches = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.textContent.toLocaleLowerCase().includes(query));
  matches.forEach(({ row }) => row.classList.add("search-match"));
  if (csvSearchResult) csvSearchResult.textContent = `${matches.length}件一致`;
  renderCsvSearchResults(matches);

  if (scrollToFirst && matches[0]) {
    matches[0].classList.add("search-current");
    matches[0].row.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function jumpToCsvRow() {
  const table = document.querySelector("#csvTableArea table");
  const input = document.getElementById("csvRowInput");
  if (!table || !input) {
    alert("先に CSV を読み込んでください");
    return;
  }

  const rowNumber = Number(input.value);
  const rows = table.querySelectorAll("tbody tr");
  if (!Number.isInteger(rowNumber) || rowNumber < 1 || rowNumber > rows.length) {
    alert(`行番号は1〜${rows.length}で指定してください`);
    return;
  }

  const row = rows[rowNumber - 1];
  row.querySelector(".row-index")?.click();
  row.classList.add("search-current");
  row.scrollIntoView({ behavior: "smooth", block: "center" });
}

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
  originalRows = cloneRows(rows);
  window._editCsvOriginalRows = cloneRows(rows);
  window._editCsvOriginalType = currentType;
  window._editCsvOriginalFile = currentFile;

  // テーブル描画
  renderCsvTable(rows);

  // 編集ロジックを紐づける
  const table = document.querySelector("#csvTableArea table");
  currentRows = attachEditor(table, originalRows);
  applyCsvSearch({ scrollToFirst: false });

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
  currentRows = attachEditor(newTable, originalRows);
  applyCsvSearch({ scrollToFirst: false });
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
  currentRows = attachEditor(newTable, originalRows);
  applyCsvSearch({ scrollToFirst: false });
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
  currentRows = attachEditor(newTable, originalRows);
  applyCsvSearch({ scrollToFirst: false });
});

document.getElementById("csvSearchBtn").addEventListener("click", () => {
  applyCsvSearch();
});

csvSearchInput?.addEventListener("keydown", e => {
  if (e.key === "Enter") applyCsvSearch();
});

document.getElementById("csvRowJumpBtn").addEventListener("click", jumpToCsvRow);

document.getElementById("csvRowInput").addEventListener("keydown", e => {
  if (e.key === "Enter") jumpToCsvRow();
});

csvSearchResults?.addEventListener("click", e => {
  const result = e.target.closest("[data-search-row]");
  if (!result) return;
  const rowNumber = Number(result.dataset.searchRow) + 1;
  const input = document.getElementById("csvRowInput");
  if (input) input.value = rowNumber;
  jumpToCsvRow();
});

// CSV 保存（全書き換え）
document.getElementById("saveCsvBtn").addEventListener("click", async () => {
  if (!currentType || !currentFile) {
    alert("先に CSV を読み込んでください");
    return;
  }

  await saveCsvFile(currentType, currentFile);
});

document.getElementById("restoreCsvBtn").addEventListener("click", async () => {
  currentType = currentType || csvTypeEl.value;
  currentFile = currentFile || csvFileEl.value;
  await restoreCsvFromBackup(currentType, currentFile);
});
