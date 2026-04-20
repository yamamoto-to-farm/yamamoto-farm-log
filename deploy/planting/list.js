import { verifyLocalAuth } from "/common/ui.js";
import { loadCSV } from "/common/csv.js";
import { loadJSON } from "/common/json.js";
import { calcAreaM2, calcAreaTan } from "/analysis/analysis-utils.js";
import { initFilterUI } from "/common/filter.js";

let plantingRows = [];
let seedRows = [];
let fieldData = [];
let varietyData = [];
let canDiscard = false;

/* ============================================================
   初期化
============================================================ */
export async function initPlantingListPage() {
  const ok = await verifyLocalAuth();
  if (!ok) return;

  if (window.currentRole === "admin") canDiscard = true;

  plantingRows = await loadCSV("/logs/planting/all.csv");
  seedRows = await loadCSV("/logs/seed/all.csv");
  fieldData = await loadJSON("/data/fields.json");
  varietyData = await loadJSON("/data/varieties.json");

  /* ▼ 年 → 月マップ生成（実データ） */
  const ymMap = {};
  plantingRows.forEach(r => {
    if (!r.plantDate) return;
    const y = r.plantDate.slice(0, 4);
    const m = r.plantDate.slice(5, 7);
    if (!ymMap[y]) ymMap[y] = [];
    if (!ymMap[y].includes(m)) ymMap[y].push(m);
  });
  Object.keys(ymMap).forEach(y => ymMap[y].sort());

  /* ▼ 圃場エリア → 圃場名 */
  const fieldMap = {};
  fieldData.forEach(f => {
    if (!fieldMap[f.area]) fieldMap[f.area] = [];
    fieldMap[f.area].push(f.name);
  });

  /* ▼ 品種タイプ → 品種名 */
  const varietyMap = {};
  varietyData.forEach(v => {
    if (!varietyMap[v.type]) varietyMap[v.type] = [];
    varietyMap[v.type].push(v.name);
  });

  /* ▼ フィルタ UI 初期化 */
  initFilterUI({
    years: Object.keys(ymMap),
    months: ymMap,
    fields: fieldMap,
    varieties: varietyMap,
    onApply: (state) => {
      const filtered = applyFilter(plantingRows, state);
      renderTable(filtered);
    }
  });

  renderTable(plantingRows);
}

/* ============================================================
   フィルタ適用
============================================================ */
function applyFilter(rows, state) {
  return rows.filter(r => {
    const y = r.plantDate?.slice(0, 4);
    const m = r.plantDate?.slice(5, 7);

    if (state.years.length && !state.years.includes(y)) return false;
    if (state.months.length && !state.months.includes(m)) return false;

    if (state.fields.length && !state.fields.includes(r.field)) return false;
    if (state.varieties.length && !state.varieties.includes(r.variety)) return false;

    return true;
  });
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
   テーブル描画 + 集計
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

/* ============================================================
   ページ起動
============================================================ */
initPlantingListPage();
