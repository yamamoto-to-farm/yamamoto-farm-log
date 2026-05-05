// annual-list.js（本番仕様）

import { getFilter, setFilterData } from "/common/filter/filter-core.js";
import { openYearModal } from "/common/filter/filter-year.js";
import { openFieldModal } from "/common/filter/filter-field.js";
import { openVarietyModal } from "/common/filter/filter-variety.js";
import { loadJSON } from "/common/json.js";

/* ============================================================
   初期化
============================================================ */
window.addEventListener("DOMContentLoaded", async () => {

  const yearList = await loadYearList();

  const fields = await loadJSON("/data/fields.json");
  const areaMap = {};
  const areaOrder = [];

  fields.forEach(f => {
    if (!areaMap[f.area]) {
      areaMap[f.area] = [];
      areaOrder.push(f.area);
    }
    areaMap[f.area].push(f.name);
  });

  const varieties = await loadJSON("/data/varieties.json");
  const typeMap = {};
  const typeOrder = [];

  varieties.forEach(v => {
    if (!typeMap[v.type]) {
      typeMap[v.type] = [];
      typeOrder.push(v.type);
    }
    typeMap[v.type].push(v.name);
  });

  setFilterData({
    years: yearList,
    months: {},
    fields: { parents: areaOrder, children: areaMap },
    varieties: { parents: typeOrder, children: typeMap }
  });

  document.querySelector('[data-type="year"]').addEventListener("click", openYearModal);
  document.querySelector('[data-type="field"]').addEventListener("click", openFieldModal);
  document.querySelector('[data-type="variety"]').addEventListener("click", openVarietyModal);

  window.addEventListener("filter:apply", (e) => {
    renderTable(e.detail);
  });

  window.addEventListener("filter:reset", () => {
    renderTable(getFilter());
  });

  renderTable(getFilter());
});

/* ============================================================
   年一覧読み込み（404 → 空配列）
============================================================ */
async function loadYearList() {
  try {
    const index = await loadJSON("/logs/schedule/annual/year-index.json");
    return index.years || [];
  } catch {
    console.warn("year-index.json が存在しません → 空の一覧");
    return [];
  }
}

/* ============================================================
   テーブル描画
============================================================ */
async function renderTable(state) {

  const years = state.yearMonths.length
    ? state.yearMonths.map(ym => ym.slice(0, 4))
    : (await loadYearList());

  const uniqueYears = [...new Set(years)].sort();

  let html = `
    <table>
      <thead>
        <tr>
          <th>年</th>
          <th>状態</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
  `;

  for (const y of uniqueYears) {

    let exists = true;

    try {
      await loadJSON(`/logs/schedule/annual/${y}-作付計画.json`);
    } catch {
      exists = false;
    }

    html += `
      <tr>
        <td>${y}</td>
        <td>${exists ? "作成済み" : "未作成"}</td>
        <td class="action-links">
          <a href="/schedule/annual/index.html?year=${y}">編集</a>
          <a href="/schedule/plan.html?year=${y}">播種・定植計画へ</a>
        </td>
      </tr>
    `;
  }

  html += `</tbody></table>`;

  document.getElementById("countArea").textContent = `${uniqueYears.length} 件`;
  document.getElementById("table-area").innerHTML = html;
}
