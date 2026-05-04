// common/filter/filter-year.js
import { setFilter, getFilter } from "./filter-core.js";

/* ============================================================
   年フィルタ UI 初期化
============================================================ */
export function initYearFilter({ targetId, years }) {
  const target = document.getElementById(targetId);
  if (!target) return;

  target.innerHTML = `
    <div class="filter-block open">
      <div class="filter-header">
        <span class="filter-label">年</span>
      </div>
      <div class="filter-children">
        ${years.map(y => `
          <div class="select-item" data-year="${y}">${y}</div>
        `).join("")}
      </div>
    </div>
  `;

  // イベント設定
  target.querySelectorAll("[data-year]").forEach(el => {
    el.addEventListener("click", () => {
      setFilter("year", el.dataset.year);
      updateYearUI(target);
    });
  });

  updateYearUI(target);
}

/* ============================================================
   UI 更新
============================================================ */
function updateYearUI(target) {
  const state = getFilter();
  target.querySelectorAll("[data-year]").forEach(el => {
    el.classList.toggle("selected", el.dataset.year == state.year);
  });
}
