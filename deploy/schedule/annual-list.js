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

  /* ------------------------------------------------------------
     ▼ 年一覧を annual フォルダから取得
     ------------------------------------------------------------ */
  const yearList = await loadYearList();

  /* ------------------------------------------------------------
     ▼ 圃場データ（fields.json）
     ------------------------------------------------------------ */
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

  /* ------------------------------------------------------------
     ▼ 品種データ（varieties.json）
     ------------------------------------------------------------ */
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

  /* ------------------------------------------------------------
     ▼ フィルタデータセット
     ------------------------------------------------------------ */
  setFilterData({
    years: yearList,
    months: {}, // 年間作付計画は月フィルタ不要
    fields: { parents: areaOrder, children: areaMap },
    varieties: { parents: typeOrder, children: typeMap }
  });

  /* ------------------------------------------------------------
     ▼ フィルタボタン
     ------------------------------------------------------------ */
  document.querySelector('[data-type="year"]').addEventListener("click", openYearModal);
  document.querySelector('[data-type="field"]').addEventListener("click", openFieldModal);
  document.querySelector('[data-type="variety"]').addEventListener("click", openVarietyModal);

  /* ------------------------------------------------------------
     ▼ フィルタイベント
     ------------------------------------------------------------ */
  window.addEventListener("filter:apply", (e) => {
    renderTable(e.detail);
  });

  window.addEventListener("filter:reset", () => {
    renderTable(getFilter());
  });

  /* ------------------------------------------------------------
     ▼ 初期表示
     ------------------------------------------------------------ */
  renderTable(getFilter());
});

/* ============================================================
   年一覧を annual フォルダから取得
============================================================ */
async function loadYearList() {
  const index = await loadJSON("/annual/year-index.json");
  return index.years || [];
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
          <th>作付計画</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
  `;

  uniqueYears.forEach(y => {
    html += `
      <tr>
        <td>${y}</td>
        <td>${y}-作付計画.json</td>
        <td class="action-links">
          <a href="/schedule/annual/index.html?year=${y}">編集</a>
          <a href="/schedule/plan.html?year=${y}">播種・定植計画へ</a>
        </td>
      </tr>
    `;
  });

  html += `</tbody></table>`;

  document.getElementById("countArea").textContent = `${uniqueYears.length} 件`;
  document.getElementById("table-area").innerHTML = html;
}
