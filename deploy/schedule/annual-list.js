// annual-list.js（フィルタ単体テスト用）

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
     ▼ 年・月（テスト用）
     ※ annual-list 本番では logs から生成する
     ------------------------------------------------------------ */
  const years = ["2024", "2025", "2026", "2027"];
  const months = {
    "2024": ["01","02","03"],
    "2025": ["04","05"],
    "2026": ["06","07"],
    "2027": ["08","09"]
  };

  /* ------------------------------------------------------------
     ▼ 旧 filter.js と同じ構造でセット
     ------------------------------------------------------------ */
  setFilterData({
    years,
    months,
    fields: { parents: areaOrder, children: areaMap },
    varieties: { parents: typeOrder, children: typeMap }
  });

  /* ------------------------------------------------------------
     ▼ UI イベント
     ------------------------------------------------------------ */

  // 年フィルタ
  document.getElementById("yearFilter").innerHTML = `
    <button class="primary-btn" id="openYear">年フィルタを開く</button>
  `;
  document.getElementById("openYear").addEventListener("click", openYearModal);

  // 圃場フィルタ
  document.getElementById("openField").addEventListener("click", openFieldModal);

  // 品種フィルタ
  document.getElementById("openVariety").addEventListener("click", openVarietyModal);

  /* ------------------------------------------------------------
     ▼ フィルタ変更イベント（旧API互換）
     ------------------------------------------------------------ */
  window.addEventListener("filter:apply", (e) => {
    updateStateBox(e.detail);
  });

  window.addEventListener("filter:reset", () => {
    updateStateBox(getFilter());
  });

  // 初期表示
  updateStateBox(getFilter());
});

/* ============================================================
   現在のフィルタ状態を表示
============================================================ */
function updateStateBox(state) {
  document.getElementById("filterStateBox").textContent =
    JSON.stringify(state, null, 2);
}
