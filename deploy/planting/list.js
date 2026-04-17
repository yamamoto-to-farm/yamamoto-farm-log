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
   親 → 子 開閉
=============================== */
window.toggleChild = function (key) {
  const el = document.getElementById("child-" + key);
  el.style.display = (el.style.display === "block") ? "none" : "block";
};

/* ===============================
   年 → 月
=============================== */
function populateYearFilter() {
  const map = {}; // {2024: ["01","02"], ...}

  plantingRows.forEach(r => {
    if (!r.plantDate) return;
    const y = r.plantDate.slice(0,4);
    const m = r.plantDate.slice(5,7);

    if (!map[y]) map[y] = new Set();
    map[y].add(m);
  });

  const container = document.getElementById("child-year");
  container.innerHTML = "";

  Object.keys(map).sort().forEach(year => {
    container.insertAdjacentHTML("beforeend", `
      <label><input type="checkbox" value="${year}" class="year-parent"> ${year}</label>
    `);

    const childDiv = document.createElement("div");
    childDiv.style.marginLeft = "20px";

    [...map[year]].sort().forEach(m => {
      childDiv.insertAdjacentHTML("beforeend", `
        <label><input type="checkbox" value="${m}" class="month-child"> ${m}月</label>
      `);
    });

    container.appendChild(childDiv);
  });
}

/* ===============================
   圃場 → 区画
=============================== */
function populateFieldFilter() {
  const map = {}; // {A圃場:["A-1","A-2"], ...}

  plantingRows.forEach(r => {
    if (!r.field) return;

    const parts = r.field.split("-");
    const parent = parts[0];
    const child = parts[1];

    if (!map[parent]) map[parent] = new Set();
    if (child) map[parent].add(r.field);
  });

  const container = document.getElementById("child-field");
  container.innerHTML = "";

  Object.keys(map).sort().forEach(field => {
    container.insertAdjacentHTML("beforeend", `
      <label><input type="checkbox" value="${field}" class="field-parent"> ${field}</label>
    `);

    const childDiv = document.createElement("div");
    childDiv.style.marginLeft = "20px";

    [...map[field]].sort().forEach(f => {
      childDiv.insertAdjacentHTML("beforeend", `
        <label><input type="checkbox" value="${f}" class="field-child"> ${f}</label>
      `);
    });

    container.appendChild(childDiv);
  });
}

/* ===============================
   品名 → 詳細（例：系統）
=============================== */
function populateVarietyFilter() {
  const map = {}; // {コシヒカリ:["早生","晩生"], ...}

  plantingRows.forEach(r => {
    if (!r.variety) return;

    const parts = r.variety.split(" ");
    const parent = parts[0];
    const child = parts[1];

    if (!map[parent]) map[parent] = new Set();
    if (child) map[parent].add(child);
  });

  const container = document.getElementById("child-variety");
  container.innerHTML = "";

  Object.keys(map).sort().forEach(v => {
    container.insertAdjacentHTML("beforeend", `
      <label><input type="checkbox" value="${v}" class="variety-parent"> ${v}</label>
    `);

    const childDiv = document.createElement("div");
    childDiv.style.marginLeft = "20px";

    [...map[v]].sort().forEach(c => {
      childDiv.insertAdjacentHTML("beforeend", `
        <label><input type="checkbox" value="${v} ${c}" class="variety-child"> ${c}</label>
      `);
    });

    container.appendChild(childDiv);
  });
}

/* ===============================
   チェックされた値を取得
=============================== */
function getCheckedValues(selector) {
  return [...document.querySelectorAll(selector + ":checked")].map(cb => cb.value);
}

/* ===============================
   フィルタ適用
=============================== */
window.applyFilter = function () {
  const years = getCheckedValues(".year-parent");
  const months = getCheckedValues(".month-child");
  const fields = [
    ...getCheckedValues(".field-parent"),
    ...getCheckedValues(".field-child")
  ];
  const varieties = [
    ...getCheckedValues(".variety-parent"),
    ...getCheckedValues(".variety-child")
  ];

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
