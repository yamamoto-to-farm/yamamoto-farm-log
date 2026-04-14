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
   フィルタ生成
=============================== */
function populateYearFilter() {
  const yearSet = new Set();
  plantingRows.forEach(r => {
    if (r.plantDate) yearSet.add(r.plantDate.slice(0, 4));
  });

  const sel = document.getElementById("filterYear");
  [...yearSet].sort().forEach(y => {
    const opt = document.createElement("option");
    opt.value = y;
    opt.textContent = y;
    sel.appendChild(opt);
  });
}

function populateFieldFilter() {
  const set = new Set();
  plantingRows.forEach(r => r.field && set.add(r.field));

  const sel = document.getElementById("filterField");
  [...set].sort().forEach(f => {
    const opt = document.createElement("option");
    opt.value = f;
    opt.textContent = f;
    sel.appendChild(opt);
  });
}

function populateVarietyFilter() {
  const set = new Set();
  plantingRows.forEach(r => r.variety && set.add(r.variety));

  const sel = document.getElementById("filterVariety");
  [...set].sort().forEach(v => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    sel.appendChild(opt);
  });
}

/* ===============================
   フィルタ適用
=============================== */
window.applyFilter = function () {
  const year = document.getElementById("filterYear").value;
  const month = document.getElementById("filterMonth").value;
  const field = document.getElementById("filterField").value;
  const variety = document.getElementById("filterVariety").value;

  const filtered = plantingRows.filter(r => {
    const y = r.plantDate?.slice(0, 4) ?? "";
    const m = r.plantDate?.slice(5, 7) ?? "";

    if (year && y !== year) return false;
    if (month && m !== month) return false;
    if (field && r.field !== field) return false;
    if (variety && r.variety !== variety) return false;

    return true;
  });

  renderTable(filtered);
};

/* ===============================
   播種日（複数対応）
=============================== */
function getSeedDates(seedRef) {
  if (!seedRef) return "";

  const refs = seedRef.split(",").map(s => s.trim());
  const dates = refs.map(ref => {
    const row = seedRows.find(s => s.seedRef === ref);
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
    const areaM2 = calcAreaM2(r.quantity, r.spacing.row, r.spacing.bed);
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