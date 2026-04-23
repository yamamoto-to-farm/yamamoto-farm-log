// ===============================
// plantingList.js（定植ベース一覧）
// ===============================

import { loadCSV, normalizeKeys } from "/common/csv.js";
import { loadJSON } from "/common/json.js";
import { calcAreaM2, calcAreaTan } from "/analysis/analysis-utils.js";

import {
  openYearModal,
  openFieldModal,
  openVarietyModal,
  setFilterData
} from "/common/filter.js";

import { showInfoModal } from "/common/showInfoModal.js";

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
  if (!initialized) {
    await initPlantingListPage();
    initialized = true;
  }
  const state = window.currentFilterState || {};
  const filtered = applyAllFilters(plantingRows, state);
  renderTable(filtered);
}

/* ============================================================
   初期化
============================================================ */
async function initPlantingListPage() {

  if (window.currentRole === "admin") canDiscard = true;

  plantingRows = normalizeKeys(await loadCSV("/logs/planting/all.csv"));
  seedRows = normalizeKeys(await loadCSV("/logs/seed/all.csv"));

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

  filterData = {
    years: Object.keys(ymMap).sort(),
    months: ymMap,
    fields: { parents: areaOrder, children: areaMap },
    varieties: { parents: typeOrder, children: typeMap }
  };

  setFilterData(filterData);

  document.querySelector('[data-type="year"]').addEventListener("click", openYearModal);
  document.querySelector('[data-type="field"]').addEventListener("click", openFieldModal);
  document.querySelector('[data-type="variety"]').addEventListener("click", openVarietyModal);

  window.addEventListener("filter:apply", (e) => {
    window.currentFilterState = e.detail;
    renderTable(applyAllFilters(plantingRows, e.detail));
  });

  window.addEventListener("filter:reset", () => {
    window.currentFilterState = {};
    renderTable(plantingRows);
  });
}

/* ============================================================
   フィルタ適用
============================================================ */
function applyAllFilters(rows, state) {

  let result = rows;

  if (state.yearMonths?.length) {
    result = result.filter(r => {
      const y = r.plantDate?.slice(0, 4);
      const m = r.plantDate?.slice(5, 7);
      return state.yearMonths.includes(`${y}-${m}`);
    });
  }

  if (state.fields?.length) {
    result = result.filter(r => state.fields.includes(r.field));
  }

  if (state.varieties?.length) {
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
   モーダル用データ
============================================================ */
function getPlantDetail(plantingRef) {
  const row = plantingRows.find(r => r.plantingRef === plantingRef);
  if (!row) {
    return {
      title: "データなし",
      html: "<p>該当データがありません。</p>"
    };
  }

  return {
    title: `定植情報：${plantingRef}`,
    html: `
      <p><b>株数：</b>${row.quantity}</p>
      <p><b>株間：</b>${row.spacingRow} cm</p>
      <p><b>畝間：</b>${row.spacingBed} cm</p>
      <p><b>トレイ種別：</b>${row.trayType}</p>
      <p><b>収穫予定：</b>${row.harvestPlanYM ?? ""}</p>
      <p><b>播種ID：</b>${row.seedRef}</p>
      <p><b>作業者：</b>${row.worker ?? ""}</p>
      <p><b>機械：</b>${row.machine ?? ""}</p>
      <p><b>メモ：</b><br>${row.notes ?? ""}</p>
    `
  };
}

/* ============================================================
   テーブル描画
============================================================ */
function renderTable(rows) {

  const tableArea = document.getElementById("table-area");

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

    const ref = r.plantingRef ?? "";

    html += `<tr>
      <td class="plant-date-cell" data-id="${ref}">${r.plantDate ?? ""}</td>
      <td><a href="/analysis/index.html?field=${encodeURIComponent(r.field)}">${r.field}</a></td>
      <td><a href="/analysis/variety.html?variety=${encodeURIComponent(r.variety)}">${r.variety}</a></td>
      <td>${areaTan.toFixed(2)}</td>
      <td>${getSeedDates(r.seedRef)}</td>
      <td>${canDiscard && ref ? `<button class="primary-btn discard-btn" data-ref="${ref}">破棄</button>` : ""}</td>
    </tr>`;
  });

  html += `
      </tbody>
    </table>
  `;

  document.getElementById("countArea").textContent = `${rows.length} 件`;
  document.getElementById("summaryArea").innerHTML =
    `株数合計：${totalQuantity.toLocaleString()} 株　
     面積合計：${totalAreaTan.toFixed(2)} 反`;

  tableArea.innerHTML = html;

  /* ▼ 定植日クリックでモーダル */
  document.querySelectorAll(".plant-date-cell").forEach(cell => {
    cell.addEventListener("click", () => {
      const ref = cell.dataset.id;
      const data = getPlantDetail(ref);
      showInfoModal(data.title, data.html);
    });
  });

  /* ▼ 破棄ボタン */
  document.querySelectorAll(".discard-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const ref = btn.dataset.ref;
      location.href = `/planting/discard-planting.html?ref=${encodeURIComponent(ref)}`;
    });
  });
}
