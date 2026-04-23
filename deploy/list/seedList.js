// ===============================
// seedList.js（播種ベース一覧）
// ===============================

import { loadCSV } from "/common/csv.js";
import { loadJSON } from "/common/json.js";
import { calcAreaM2, calcAreaTan } from "/analysis/analysis-utils.js";

import {
  openYearModal,
  openFieldModal,
  openVarietyModal,
  setFilterData
} from "/common/filter.js";

import { showInfoModal } from "/common/showInfoModal.js";


let seedRows = [];
let plantingRows = [];
let seedToPlantingMap = {}; // seedRef → plantingRef[]

// ===============================
// 初期化
// ===============================
export async function renderSeedList() {

  // ▼ CSV 読み込み
  seedRows = normalizeKeys(await loadCSV("/logs/seed/all.csv"));
  plantingRows = normalizeKeys(await loadCSV("/logs/planting/all.csv"));

  // ▼ seedRef → plantingRef の逆参照マップ作成
  buildSeedToPlantingMap();

  // ▼ フィルタ適用
  const filters = getActiveFilters();
  const filtered = applyFilterToRows(seedRows, filters, {
    dateKey: "seedDate",
    fieldKey: null,        // 播種一覧は圃場なし
    varietyKey: "varietyName"
  });

  // ▼ テーブル描画
  renderTable(filtered);

  // ▼ 件数表示
  document.getElementById("countArea").textContent = `${filtered.length} 件`;
}


// ===============================
// seedRef → plantingRef[] の逆参照
// ===============================
function buildSeedToPlantingMap() {
  seedToPlantingMap = {};

  plantingRows.forEach(row => {
    if (!row.seedref) return;

    const refs = row.seedref.split(",").map(s => s.trim());
    refs.forEach(ref => {
      if (!seedToPlantingMap[ref]) seedToPlantingMap[ref] = [];
      seedToPlantingMap[ref].push(row.plantingref);
    });
  });
}


// ===============================
// 予定面積(反)の計算（株間34cm / 畝間60cm）
// ===============================
function calcSeedAreaTan(seedCount) {
  const spacingRow = 34; // 株間(cm)
  const spacingBed = 60; // 畝間(cm)

  const areaM2 = calcAreaM2(seedCount, spacingRow, spacingBed);
  return calcAreaTan(areaM2);
}


// ===============================
// テーブル描画
// ===============================
function renderTable(rows) {
  const tableArea = document.getElementById("table-area");
  tableArea.innerHTML = "";

  const table = document.createElement("table");
  table.classList.add("data-table");

  // ▼ ヘッダー
  table.innerHTML = `
    <thead>
      <tr>
        <th>播種日</th>
        <th>品種</th>
        <th>枚数</th>
        <th>予定面積(反)</th>
        <th>定植ID</th>
        <th>操作</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;

  const tbody = table.querySelector("tbody");

  rows.forEach(row => {
    const tr = document.createElement("tr");

    const seedRef = row.seedref;
    const seedDate = row.seeddate || "";
    const variety = row.varietyname || "";
    const trayCount = row.traycount || "";
    const seedCount = Number(row.seedcount || 0);

    const areaTan = calcSeedAreaTan(seedCount).toFixed(3);

    const plantingRefs = seedToPlantingMap[seedRef] || [];
    const plantingHtml = plantingRefs.length
      ? plantingRefs.join("<br>")
      : "-";

    tr.innerHTML = `
      <td class="seed-date-cell" data-seedref="${seedRef}">${seedDate}</td>
      <td>${variety}</td>
      <td>${trayCount}</td>
      <td>${areaTan}</td>
      <td>${plantingHtml}</td>
      <td>${renderOperationCell(seedRef)}</td>
    `;

    // ▼ 播種日クリック → モーダル
    tr.querySelector(".seed-date-cell").addEventListener("click", () => {
      showSeedModal(row);
    });

    tbody.appendChild(tr);
  });

  tableArea.appendChild(table);
}


// ===============================
// 操作セル（破棄）
// ===============================
function renderOperationCell(seedRef) {
  if (!isAdmin()) return "-";

  return `
    <button class="danger-btn" data-seedref="${seedRef}">
      破棄
    </button>
  `;
}


// ===============================
// モーダル表示（播種情報）
// ===============================
function showSeedModal(row) {
  const seedRef = row.seedref;
  const seedCount = row.seedcount || "";
  const trayType = row.traytype || "";
  const memo = row.memo || "";
  const source = row.source || "";

  const html = `
    <h2>播種情報</h2>

    <p><b>播種ID：</b><br>${seedRef}</p>
    <p><b>株数：</b><br>${seedCount}</p>
    <p><b>トレイ種別：</b><br>${trayType}</p>
    <p><b>メモ：</b><br>${memo}</p>
    <p><b>種子の種類：</b><br>${source}</p>

    <p><b>備考：</b><br>
      ※予定面積は 株間：34cm / 畝間：60cm を基準に計算しています
    </p>
  `;

  showInfoModal(html);
}
