// annual-list.js（フィルタ単体テスト用）

import { getFilter } from "/common/filter/filter-core.js";
import { initYearFilter } from "/common/filter/filter-year.js";
import { openFieldModal } from "/common/filter/filter-field.js";
import { openVarietyModal } from "/common/filter/filter-variety.js";

/* ============================================================
   初期化
============================================================ */
window.addEventListener("DOMContentLoaded", () => {

  /* ▼ 年フィルタのテスト */
  initYearFilter({
    targetId: "yearFilter",
    years: ["2024", "2025", "2026", "2027"]
  });

  /* ▼ 圃場フィルタのテスト */
  document.getElementById("openField").addEventListener("click", () => {
    openFieldModal({
      parents: ["赤沢", "西畑"],
      children: {
        "赤沢": ["赤沢(上)", "赤沢(中)", "赤沢(下)"],
        "西畑": ["西畑(北)", "西畑(南)"]
      }
    });
  });

  /* ▼ 品種フィルタのテスト */
  document.getElementById("openVariety").addEventListener("click", () => {
    openVarietyModal({
      parents: ["葉物", "果菜"],
      children: {
        "葉物": ["ほうれん草", "小松菜"],
        "果菜": ["トマト", "ナス", "ピーマン"]
      }
    });
  });

  /* ▼ フィルタ変更イベントを監視 */
  window.addEventListener("filter2:change", (e) => {
    updateStateBox(e.detail);
  });

  window.addEventListener("filter2:reset", () => {
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
