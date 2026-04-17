import { verifyLocalAuth } from "/common/ui.js";
import { loadCSV } from "/common/csv.js";
import { calcAreaM2, calcAreaTan } from "/analysis/analysis-utils.js";

let plantingRows = [];
let seedRows = [];
let canDiscard = false;

/* ===============================
   初期化
=============================== */
export async function initPlantingListPage() {
  const ok = await verifyLocalAuth();
  if (!ok) return;

  if (window.currentRole === "admin") {
    canDiscard = true;
  }

  plantingRows = await loadCSV("/logs/planting/all.csv");
  seedRows = await loadCSV("/logs/seed/all.csv");

  populateYearFilter();
  populateMonthFilter();
  populateFieldFilter();
  populateVarietyFilter();

  renderTable(plantingRows);
}

/* ===============================
   フィルタ折りたたみ
=============================== */
window.toggleFilter = function () {
  document.getElementById("filter-card").classList.toggle("open");
};

/* ===============================
   チェックボックス生成
=============================== */
function createCheckboxGroup(containerId, values) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";

  values.forEach(v => {
    const id = `${containerId}_${v}`;
    container.insertAdjacentHTML("beforeend", `
      <label>
        <input type="checkbox" value="${v}" id="${id}">
        ${v}
      </label>
    `);
  });
}

/* ===============================
   フィルタ生成
=============================== */
function populateYearFilter() {
  const set = new Set();
  plantingRows.forEach(r => {
    if (r.plantDate) set.add(r.plantDate.slice(0, 4));
  });
  createCheckboxGroup("filterYear", [...set].sort());
}

function populateMonthFilter() {
  createCheckboxGroup("filterMonth", [
    "01","02","03","04","05","06",
    "07","08","09","10","11","12"
  ]);
}

function populateFieldFilter() {
  const set = new Set();
  plantingRows.forEach(r => r.field && set.add(r.field));
  createCheckboxGroup("filterField", [...set].sort());
}

function populateVarietyFilter() {
  const set = new Set();
  plantingRows.forEach(r => r.variety && set.add(r.variety));
  createCheckboxGroup("filterVariety", [...set].sort());
}

/* ===============================
   チェックされた値を取得
=============================== */
function getCheckedValues(containerId) {
  return [...document.querySelectorAll(`#${containerId} input[type=checkbox]:checked`)]
    .map(cb => cb.value);
}

/* ===============================
   フィルタ適用
=============================== */
window.applyFilter = function () {
  const years = getCheckedValues("filterYear");
  const months = getCheckedValues("filterMonth");
  const fields = getCheckedValues("filterField");
  const varieties = getCheckedValues("filterVariety");

  const filtered = plantingRows.filter(r => {
    const y = r.plantDate?.slice(0,4);
    const m = r.plantDate?.slice(5,7);

    if (years.length && !years.includes(y)) return false;
    if (months.length && !months.includes(m)) return false;
    if (fields.length && !fields.includes(r.field)) return false;
    if (varieties.length && !varieties.includes(r.variety)) return false;

    return true;
  });

  renderTable(filtered);
};

/* ===============================
   播種日（複数対応）
=============================== */
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

/* ===============================
   テーブル描画
=============================== */
function renderTable(rows) {
  document.getElementById("countArea").textContent = `${rows.length} 件`;

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

/* ===============================
   ページ起動
=============================== */
initPlantingListPage();
