// ===============================
// plantingList.js（定植ベース一覧）
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

let plantingRows = [];
let seedRows = [];
let fieldData = [];
let varietyData = [];
let canDiscard = false;

let filterData = {};
let initialized = false;

/* ============================================================
   外部から呼ばれるエントリポイント
============================================================ */
export async function renderPlantingList() {

  // 初回のみデータ読み込み & フィルタ初期化
  if (!initialized) {
    await initPlantingListPage();
    initialized = true;
  }

  // 現在のフィルタ状態を取得して再描画
  const state = window.currentFilterState || {};
  const filtered = applyAllFilters(plantingRows, state);
  renderTable(filtered);
}

/* ============================================================
   初期化（データ読み込み・フィルタ構築）
============================================================ */
async function initPlantingListPage() {

  if (window.currentRole === "admin") canDiscard = true;

  plantingRows = await loadCSV("/logs/planting/all.csv");
  seedRows = await loadCSV("/logs/seed/all.csv");
  fieldData = await loadJSON("/data/fields.json");
  varietyData = await loadJSON("/data/varieties.json");

  /* ▼ 年 → 月マップ生成 */
  const ymMap = {};
  plantingRows.forEach(r => {
    if (!r.plantDate) return;
    const y = r.plantDate.slice(0, 4);
    const m = r.plantDate.slice(5, 7);
    if (!ymMap[y]) ymMap[y] = [];
    if (!ymMap[y].includes(m)) ymMap[y].push(m);
  });
  Object.keys(ymMap).forEach(y => ymMap[y].sort());

  /* ▼ 圃場 area → name */
  const areaMap = {};
  const areaOrder = [];

  fieldData.forEach(f => {
    if (!areaMap[f.area]) {
      areaMap[f.area] = [];
      areaOrder.push(f.area);
    }
    areaMap[f.area].push(f.name);
  });

  /* ▼ 品種 type → name */
  const typeMap = {};
  const typeOrder = [];

  varietyData.forEach(v => {
    if (!typeMap[v.type]) {
      typeMap[v.type] = [];
      typeOrder.push(v.type);
    }
    typeMap[v.type].push(v.name);
  });

  /* ▼ filter.js に渡すデータ構造 */
  filterData = {
    years: Object.keys(ymMap).sort(),
    months: ymMap,
    fields: {
      parents: areaOrder,
      children: areaMap
    },
    varieties: {
      parents: typeOrder,
      children: typeMap
    }
  };

  setFilterData(filterData);

  /* ▼ フィルタボタン */
  document.querySelector('[data-type="year"]')
    .addEventListener("click", openYearModal);

  document.querySelector('[data-type="field"]')
    .addEventListener("click", openFieldModal);

  document.querySelector('[data-type="variety"]')
    .addEventListener("click", openVarietyModal);

  /* ▼ フィルタ適用 */
  window.addEventListener("filter:apply", (e) => {
    window.currentFilterState = e.detail;
    const filtered = applyAllFilters(plantingRows, e.detail);
    renderTable(filtered);
  });

  /* ▼ 全解除 */
  window.addEventListener("filter:reset", () => {
    window.currentFilterState = {};
    renderTable(plantingRows);
  });
}

/* ============================================================
   フィルタ適用（年＋圃場＋品種）
============================================================ */
function applyAllFilters(rows, state) {

  let result = rows;

  // 年月
  if (state.yearMonths && state.yearMonths.length > 0) {
    result = result.filter(r => {
      const y = r.plantDate?.slice(0, 4);
      const m = r.plantDate?.slice(5, 7);
      return state.yearMonths.includes(`${y}-${m}`);
    });
  }

  // 圃場
  if (state.fields && state.fields.length > 0) {
    result = result.filter(r => state.fields.includes(r.field));
  }

  // 品種
  if (state.varieties && state.varieties.length > 0) {
    result = result.filter(r => state.varieties.includes(r.variety));
  }

  return result;
}

/* ============================================================
   播種日（複数対応）
============================================================ */
function getSeedDates(seedRef) {
  if (!seedRef) return "";

  const clean = s => (s ?? "").replace(/\s+/g, "").trim();
  const refs = seedRef.split(",").map(s => clean(s));

  const dates = refs.map(ref => {
    const row = seedRows.find(s => clean(s.seedRef) === ref);
    return row?.seedDate ?? "";
  });

  return dates.filter(d => d).join("<br>");
}

/* ============================================================
   テーブル描画（#table-area に生成）
============================================================ */
function renderTable(rows) {

  const tableArea = document.getElementById("table-area");

  // テーブル全体を生成
  let html = `
    <table>
      <thead>
        <tr>
          <th>定植日</th>
          <th>圃場</th>
          <th>品種</th>
          <th>面積(反)</th>
          <th>播種日</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
  `;

  let totalQuantity = 0;
  let totalAreaTan = 0;

  rows.forEach(r => {
    const spacing = {
      row: Number(r.spacingRow || 0),
      bed: Number(r.spacingBed || 0)
    };

    const areaM2 = calcAreaM2(r.quantity, spacing.row, spacing.bed);
    const areaTan = calcAreaTan(areaM2);

    totalQuantity += Number(r.quantity || 0);
    totalAreaTan += areaTan;

    html += `
      <tr>
        <td>${r.plantDate ?? ""}</td>

        <td>
          <a href="/analysis/index.html?field=${encodeURIComponent(r.field)}">
            ${r.field}
          </a>
        </td>

        <td>
          <a href="/analysis/variety.html?variety=${encodeURIComponent(r.variety)}">
            ${r.variety}
          </a>
        </td>

        <td>${areaTan.toFixed(2)}</td>

        <td>${getSeedDates(r.seedRef)}</td>

        <td>
          ${canDiscard
            ? `<button class="primary-btn" style="padding:6px 10px; font-size:14px;"
                 onclick="location.href='discard-planting.html?ref=${r.plantingRef}'">
                 破棄
               </button>`
            : ""
          }
        </td>
      </tr>
    `;
  });

  html += `
      </tbody>
    </table>
  `;

  // 集計更新
  document.getElementById("countArea").textContent = `${rows.length} 件`;
  document.getElementById("summaryArea").innerHTML =
    `株数合計：${totalQuantity.toLocaleString()} 株　
     面積合計：${totalAreaTan.toFixed(2)} 反`;

  // 描画
  tableArea.innerHTML = html;
}
