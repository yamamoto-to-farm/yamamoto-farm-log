import { verifyLocalAuth } from "/common/ui.js";
import { loadCSV } from "/common/csv.js";
import { loadJSON } from "/common/json.js";
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
  fieldData = await loadJSON("/data/fields.json");
  varietyData = await loadJSON("/data/varieties.json");

  populateYearMonthFilter();
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
   年月フィルタ（年月 → 年 → 月）
=============================== */
function populateYearMonthFilter() {
  const root = document.getElementById("filterYearMonthRoot");
  root.innerHTML = "";

  root.insertAdjacentHTML("beforeend", `
    <label>
      <input type="checkbox" id="ym_root" value="__ALL_YM__">
      <span class="filter-toggle" data-root="ym">▶ 年月</span>
    </label>
    <div class="filter-children" id="ym_year_children"></div>
  `);

  const ymMap = {};
  plantingRows.forEach(r => {
    if (!r.plantDate) return;
    const y = r.plantDate.slice(0, 4);
    const m = r.plantDate.slice(5, 7);
    if (!ymMap[y]) ymMap[y] = new Set();
    ymMap[y].add(m);
  });

  const yearContainer = document.getElementById("ym_year_children");

  Object.keys(ymMap).sort().forEach(year => {
    const yearId = `ym_year_${year}`;

    yearContainer.insertAdjacentHTML("beforeend", `
      <div class="filter-mid-block">
        <label>
          <input type="checkbox" id="${yearId}" value="${year}">
          <span class="filter-toggle" data-year="${year}">▶ ${year}年</span>
        </label>
        <div class="filter-children" id="ym_month_children_${year}"></div>
      </div>
    `);

    const monthDiv = document.getElementById(`ym_month_children_${year}`);
    [...ymMap[year]].sort().forEach(month => {
      monthDiv.insertAdjacentHTML("beforeend", `
        <div class="filter-leaf-block">
          <label>
            <input type="checkbox" value="${year}-${month}">
            ${month}月
          </label>
        </div>
      `);
    });

    document.querySelector(`.filter-toggle[data-year="${year}"]`)
      .addEventListener("click", () => {
        const div = document.getElementById(`ym_month_children_${year}`);
        div.classList.toggle("open");
      });

    document.getElementById(yearId).addEventListener("change", e => {
      const checked = e.target.checked;
      [...ymMap[year]].forEach(month => {
        const cb = monthDiv.querySelector(`input[value="${year}-${month}"]`);
        if (cb) cb.checked = checked;
      });
    });
  });

  document.querySelector(`.filter-toggle[data-root="ym"]`)
    .addEventListener("click", () => {
      document.getElementById("ym_year_children").classList.toggle("open");
    });

  document.getElementById("ym_root").addEventListener("change", e => {
    const checked = e.target.checked;
    Object.keys(ymMap).forEach(year => {
      const ycb = document.getElementById(`ym_year_${year}`);
      if (ycb) ycb.checked = checked;
      [...ymMap[year]].forEach(month => {
        const cb = document.querySelector(`input[value="${year}-${month}"]`);
        if (cb) cb.checked = checked;
      });
    });
  });
}

/* ===============================
   圃場フィルタ（圃場 → エリア → 圃場名）
=============================== */
function populateFieldFilter() {
  const root = document.getElementById("filterFieldRoot");
  root.innerHTML = "";

  root.insertAdjacentHTML("beforeend", `
    <label>
      <input type="checkbox" id="field_root" value="__ALL_FIELD__">
      <span class="filter-toggle" data-root="field">▶ 圃場</span>
    </label>
    <div class="filter-children" id="field_area_children"></div>
  `);

  const areaMap = {};
  fieldData.forEach(f => {
    if (!areaMap[f.area]) areaMap[f.area] = [];
    areaMap[f.area].push(f.name);
  });

  const areaContainer = document.getElementById("field_area_children");

  Object.keys(areaMap).sort().forEach(area => {
    const areaId = `field_area_${area}`;

    areaContainer.insertAdjacentHTML("beforeend", `
      <div class="filter-mid-block">
        <label>
          <input type="checkbox" id="${areaId}" value="${area}">
          <span class="filter-toggle" data-area="${area}">▶ ${area}</span>
        </label>
        <div class="filter-children" id="children_${area}"></div>
      </div>
    `);

    const childDiv = document.getElementById(`children_${area}`);
    areaMap[area].forEach(fieldName => {
      childDiv.insertAdjacentHTML("beforeend", `
        <div class="filter-leaf-block">
          <label>
            <input type="checkbox" value="${fieldName}">
            ${fieldName}
          </label>
        </div>
      `);
    });

    document.querySelector(`.filter-toggle[data-area="${area}"]`)
      .addEventListener("click", () => {
        childDiv.classList.toggle("open");
      });

    document.getElementById(areaId).addEventListener("change", e => {
      const checked = e.target.checked;
      childDiv.querySelectorAll("input[type=checkbox]").forEach(cb => cb.checked = checked);
    });
  });

  document.querySelector(`.filter-toggle[data-root="field"]`)
    .addEventListener("click", () => {
      document.getElementById("field_area_children").classList.toggle("open");
    });

  document.getElementById("field_root").addEventListener("change", e => {
    const checked = e.target.checked;
    areaContainer.querySelectorAll("input[type=checkbox]").forEach(cb => cb.checked = checked);
  });
}

/* ===============================
   品種フィルタ（品種 → type → 品種名）
=============================== */
function populateVarietyFilter() {
  const root = document.getElementById("filterVarietyRoot");
  root.innerHTML = "";

  root.insertAdjacentHTML("beforeend", `
    <label>
      <input type="checkbox" id="variety_root" value="__ALL_VAR__">
      <span class="filter-toggle" data-root="variety">▶ 品種</span>
    </label>
    <div class="filter-children" id="variety_type_children"></div>
  `);

  const typeMap = {};
  varietyData.forEach(v => {
    if (!typeMap[v.type]) typeMap[v.type] = [];
    typeMap[v.type].push(v.name);
  });

  const typeContainer = document.getElementById("variety_type_children");

  Object.keys(typeMap).sort().forEach(type => {
    const typeId = `variety_type_${type}`;

    typeContainer.insertAdjacentHTML("beforeend", `
      <div class="filter-mid-block">
        <label>
          <input type="checkbox" id="${typeId}" value="${type}">
          <span class="filter-toggle" data-type="${type}">▶ ${type}</span>
        </label>
        <div class="filter-children" id="children_type_${type}"></div>
      </div>
    `);

    const childDiv = document.getElementById(`children_type_${type}`);
    typeMap[type].forEach(varName => {
      childDiv.insertAdjacentHTML("beforeend", `
        <div class="filter-leaf-block">
          <label>
            <input type="checkbox" value="${varName}">
            ${varName}
          </label>
        </div>
      `);
    });

    document.querySelector(`.filter-toggle[data-type="${type}"]`)
      .addEventListener("click", () => {
        childDiv.classList.toggle("open");
      });

    document.getElementById(typeId).addEventListener("change", e => {
      const checked = e.target.checked;
      childDiv.querySelectorAll("input[type=checkbox]").forEach(cb => cb.checked = checked);
    });
  });

  document.querySelector(`.filter-toggle[data-root="variety"]`)
    .addEventListener("click", () => {
      document.getElementById("variety_type_children").classList.toggle("open");
    });

  document.getElementById("variety_root").addEventListener("change", e => {
    const checked = e.target.checked;
    typeContainer.querySelectorAll("input[type=checkbox]").forEach(cb => cb.checked = checked);
  });
}

/* ===============================
   フィルタ適用
=============================== */
window.applyFilter = function () {
  const ymValues = [...document.querySelectorAll("#filterYearMonthRoot input[type=checkbox]:checked")]
    .map(cb => cb.value)
    .filter(v => v.includes("-"));

  const fields = [...document.querySelectorAll("#filterFieldRoot input[type=checkbox]:checked")]
    .map(cb => cb.value)
    .filter(v => !v.startsWith("__"));

  const varieties = [...document.querySelectorAll("#filterVarietyRoot input[type=checkbox]:checked")]
    .map(cb => cb.value)
    .filter(v => !v.startsWith("__"));

  const filtered = plantingRows.filter(r => {
    const y = r.plantDate?.slice(0, 4);
    const m = r.plantDate?.slice(5, 7);
    const ym = (y && m) ? `${y}-${m}` : null;

    if (ymValues.length && (!ym || !ymValues.includes(ym))) return false;

    if (fields.length && !fields.includes(r.field)) {
      const fInfo = fieldData.find(f => f.name === r.field);
      if (!fInfo || !fields.includes(fInfo.area)) return false;
    }

    if (varieties.length && !varieties.includes(r.variety)) {
      const vInfo = varietyData.find(v => v.name === r.variety);
      if (!vInfo || !varieties.includes(vInfo.type)) return false;
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

/* ===============================
   ページ起動
=============================== */
initPlantingListPage();
