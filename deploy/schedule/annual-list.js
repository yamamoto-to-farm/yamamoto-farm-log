// annual-list.js（現行 annual.json 仕様に完全対応）

import { getFilter, setFilterData } from "/common/filter/filter-core.js";
import { openYearModal } from "/common/filter/filter-year.js";
import { openFieldModal } from "/common/filter/filter-field.js";
import { openVarietyModal } from "/common/filter/filter-variety.js";
import { loadJSON } from "/common/json.js";

/* ============================================================
   初期化
============================================================ */
window.addEventListener("DOMContentLoaded", async () => {

  // ★ annual.json を読み込む（全年度が入っている）
  const annualAll = await loadAnnualAll();
  const yearList = Object.keys(annualAll).sort();

  // 圃場データ
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

  // 品種データ
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

  // フィルタデータ登録
  setFilterData({
    years: yearList,
    months: {},
    fields: { parents: areaOrder, children: areaMap },
    varieties: { parents: typeOrder, children: typeMap }
  });

  // フィルタボタン
  document.querySelector('[data-type="year"]').addEventListener("click", openYearModal);
  document.querySelector('[data-type="field"]').addEventListener("click", openFieldModal);
  document.querySelector('[data-type="variety"]').addEventListener("click", openVarietyModal);

  // フィルタ適用
  window.addEventListener("filter:apply", (e) => {
    renderTable(annualAll, e.detail);
  });

  // フィルタリセット
  window.addEventListener("filter:reset", () => {
    renderTable(annualAll, getFilter());
  });

  // 初回描画
  renderTable(annualAll, getFilter());
});

/* ============================================================
   annual.json 読み込み（404 → 空）
============================================================ */
async function loadAnnualAll() {
  try {
    return await loadJSON("/logs/schedule/annual/annual.json");
  } catch {
    console.warn("annual.json が存在しません → 空で開始");
    return {};
  }
}

/* ============================================================
   テーブル描画（年度一覧）
============================================================ */
function renderTable(annualAll, state) {

  // フィルタされた年リスト
  const years = state.yearMonths.length
    ? [...new Set(state.yearMonths.map(ym => ym.slice(0, 4)))]
    : Object.keys(annualAll);

  const uniqueYears = years.sort();

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

    const exists = !!annualAll[y];

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
