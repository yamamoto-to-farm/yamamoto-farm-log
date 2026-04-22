import { verifyLocalAuth } from "/common/ui.js";
import { loadCSV } from "/common/csv.js";
import { loadJSON } from "/common/json.js";
import { calcAreaM2, calcAreaTan } from "/analysis/analysis-utils.js";

import { 
  openYearModal,
  openFieldModal,
  setFilterData
} from "/common/filter.js";

let plantingRows = [];
let seedRows = [];
let fieldData = [];
let varietyData = [];
let canDiscard = false;

let filterData = {};

/* ============================================================
   初期化
============================================================ */
export async function initPlantingListPage() {

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

  /* ▼ 圃場 area → name マップ生成（fields.json の順番を保持） */
  const areaMap = {};
  const areaOrder = [];   // ★ fields.json の順番でエリアを保持

  fieldData.forEach(f => {
    if (!areaMap[f.area]) {
      areaMap[f.area] = [];
      areaOrder.push(f.area);   // ← fields.json の順番で追加
    }
    areaMap[f.area].push(f.name);
  });

  /* ▼ filter.js に渡すデータ構造 */
  filterData = {
    years: Object.keys(ymMap).sort(),
    months: ymMap,
    fields: {
      parents: areaOrder,   // ★ fields.json の順番でエリアを表示
      children: areaMap
    }
  };

  setFilterData(filterData);

  /* ▼ フィルタボタン */
  document.querySelector('[data-type="year"]')
    .addEventListener("click", openYearModal);

  document.querySelector('[data-type="field"]')
    .addEventListener("click", openFieldModal);

  /* ▼ フィルタ適用 */
  window.addEventListener("filter:apply", (e) => {
    const state = e.detail;
    const filtered = applyAllFilters(plantingRows, state);
    renderTable(filtered);
  });

  /* ▼ 全解除 */
  window.addEventListener("filter:reset", () => {
    renderTable(plantingRows);
  });

  renderTable(plantingRows);
}

/* ============================================================
   フィルタ適用（年＋圃場）
============================================================ */
function applyAllFilters(rows, state) {

  let result = rows;

  // 年月フィルタ
  if (state.yearMonths && state.yearMonths.length > 0) {
    result = result.filter(r => {
      const y = r.plantDate?.slice(0, 4);
      const m = r.plantDate?.slice(5, 7);
      return state.yearMonths.includes(`${y}-${m}`);
    });
  }

  // 圃場フィルタ
  if (state.fields && state.fields.length > 0) {
    result = result.filter(r => state.fields.includes(r.field));
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
   テーブル描画
============================================================ */
function renderTable(rows) {
  document.getElementById("countArea").textContent = `${rows.length} 件`;

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
  });

  document.getElementById("summaryArea").innerHTML =
    `株数合計：${totalQuantity.toLocaleString()} 株　
     面積合計：${totalAreaTan.toFixed(2)} 反`;

  const tbody = document.querySelector("#plantingTable tbody");
  tbody.innerHTML = "";
  const frag = document.createDocumentFragment();

  rows.forEach(r => {
    const spacing = {
      row: Number(r.spacingRow || 0),
      bed: Number(r.spacingBed || 0)
    };

    const areaM2 = calcAreaM2(r.quantity, spacing.row, spacing.bed);
    const areaTan = calcAreaTan(areaM2);

    const tr = document.createElement("tr");

    tr.innerHTML = `
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
    `;

    frag.appendChild(tr);
  });

  tbody.appendChild(frag);
}

initPlantingListPage();
