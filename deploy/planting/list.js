import { verifyLocalAuth } from "/common/ui.js";
import { loadCSV } from "/common/csv.js";
import { loadJSON } from "/common/json.js";   // ← これが正しい
import { calcAreaM2, calcAreaTan } from "/analysis/analysis-utils.js";


let plantingRows = [];
let seedRows = [];
let fieldData = [];
let varietyData = [];
let canDiscard = false;

/* ===============================
   初期化
=============================== */
export async function initPlantingListPage() {
  const ok = await verifyLocalAuth();
  if (!ok) return;

  if (window.currentRole === "admin") canDiscard = true;

  plantingRows = await loadCSV("/logs/planting/all.csv");
  seedRows = await loadCSV("/logs/seed/all.csv");
  fieldData = await loadJSON("/data/field.json");
  varietyData = await loadJSON("/data/varieties.json");

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
   年・月フィルタ
=============================== */
function populateYearFilter() {
  const set = new Set();
  plantingRows.forEach(r => r.plantDate && set.add(r.plantDate.slice(0,4)));
  createCheckboxGroup("filterYear", [...set].sort());
}

function populateMonthFilter() {
  createCheckboxGroup("filterMonth", [
    "01","02","03","04","05","06",
    "07","08","09","10","11","12"
  ]);
}

/* ===============================
   圃場フィルタ（エリア → 圃場）
=============================== */
function populateFieldFilter() {
  const areaMap = {}; // area → [fields]

  fieldData.forEach(f => {
    if (!areaMap[f.area]) areaMap[f.area] = [];
    areaMap[f.area].push(f.id);
  });

  const areaContainer = document.getElementById("filterFieldArea");
  areaContainer.innerHTML = "";

  Object.keys(areaMap).sort().forEach(area => {
    const areaId = `area_${area}`;

    areaContainer.insertAdjacentHTML("beforeend", `
      <div class="area-block">
        <label>
          <input type="checkbox" id="${areaId}" value="${area}">
          <span class="area-toggle" data-area="${area}">▶ ${area}</span>
        </label>
        <div class="field-children" id="children_${area}" style="display:none; margin-left:20px;"></div>
      </div>
    `);

    const childDiv = document.getElementById(`children_${area}`);
    areaMap[area].forEach(field => {
      const fieldId = `field_${field}`;
      childDiv.insertAdjacentHTML("beforeend", `
        <label style="display:block;">
          <input type="checkbox" id="${fieldId}" value="${field}">
          ${field}
        </label>
      `);
    });

    // 展開/折りたたみ
    document.querySelector(`.area-toggle[data-area="${area}"]`)
      .addEventListener("click", () => {
        const div = document.getElementById(`children_${area}`);
        div.style.display = div.style.display === "none" ? "block" : "none";
      });

    // エリアにチェック → 子圃場すべてチェック
    document.getElementById(areaId).addEventListener("change", e => {
      const checked = e.target.checked;
      areaMap[area].forEach(field => {
        const cb = document.getElementById(`field_${field}`);
        if (cb) cb.checked = checked;
      });
    });
  });

  // 個別圃場一覧（平坦）
  createCheckboxGroup("filterField", fieldData.map(f => f.id).sort());
}

/* ===============================
   品種フィルタ（type → 品種）
=============================== */
function populateVarietyFilter() {
  const typeMap = {}; // type → [varieties]

  varietyData.forEach(v => {
    if (!typeMap[v.type]) typeMap[v.type] = [];
    typeMap[v.type].push(v.id);
  });

  const typeContainer = document.getElementById("filterVarietyType");
  typeContainer.innerHTML = "";

  Object.keys(typeMap).sort().forEach(type => {
    const typeId = `type_${type}`;

    typeContainer.insertAdjacentHTML("beforeend", `
      <div class="type-block">
        <label>
          <input type="checkbox" id="${typeId}" value="${type}">
          <span class="type-toggle" data-type="${type}">▶ ${type}</span>
        </label>
        <div class="variety-children" id="children_type_${type}" style="display:none; margin-left:20px;"></div>
      </div>
    `);

    const childDiv = document.getElementById(`children_type_${type}`);
    typeMap[type].forEach(v => {
      const vId = `variety_${v}`;
      childDiv.insertAdjacentHTML("beforeend", `
        <label style="display:block;">
          <input type="checkbox" id="${vId}" value="${v}">
          ${v}
        </label>
      `);
    });

    // 展開/折りたたみ
    document.querySelector(`.type-toggle[data-type="${type}"]`)
      .addEventListener("click", () => {
        const div = document.getElementById(`children_type_${type}`);
        div.style.display = div.style.display === "none" ? "block" : "none";
      });

    // type にチェック → 子品種すべてチェック
    document.getElementById(typeId).addEventListener("change", e => {
      const checked = e.target.checked;
      typeMap[type].forEach(v => {
        const cb = document.getElementById(`variety_${v}`);
        if (cb) cb.checked = checked;
      });
    });
  });

  // 個別品種一覧（平坦）
  createCheckboxGroup("filterVariety", varietyData.map(v => v.id).sort());
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
  const areas = getCheckedValues("filterFieldArea");
  const varieties = getCheckedValues("filterVariety");
  const types = getCheckedValues("filterVarietyType");

  const filtered = plantingRows.filter(r => {
    const y = r.plantDate?.slice(0,4);
    const m = r.plantDate?.slice(5,7);

    if (years.length && !years.includes(y)) return false;
    if (months.length && !months.includes(m)) return false;

    // 圃場（個別 or エリア）
    if (fields.length || areas.length) {
      const fInfo = fieldData.find(f => f.id === r.field);
      const area = fInfo?.area;

      const matchField = fields.includes(r.field);
      const matchArea = areas.includes(area);

      if (!matchField && !matchArea) return false;
    }

    // 品種（個別 or type）
    if (varieties.length || types.length) {
      const vInfo = varietyData.find(v => v.id === r.variety);
      const type = vInfo?.type;

      const matchVariety = varieties.includes(r.variety);
      const matchType = types.includes(type);

      if (!matchVariety && !matchType) return false;
    }

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
   テーブル描画 + 集計
=============================== */
function renderTable(rows) {
  document.getElementById("countArea").textContent = `${rows.length} 件`;

  // ★ 集計
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

  // ★ テーブル描画
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
