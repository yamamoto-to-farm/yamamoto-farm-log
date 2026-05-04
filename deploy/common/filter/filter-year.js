// common/filter/filter-year.js

import { filterState, getFilterData, applyFilter, resetFilter } from "./filter-core.js";
import { openModal, closeModal } from "./filter-ui.js";

/* ============================================================
   年フィルタ（旧 API と互換）
============================================================ */
export function openYearModal() {
  const data = getFilterData();
  const years = data.years || [];
  const months = data.months || {};

  const html = `
    <div class="modal-bg" id="modal-bg">
      <div class="modal">
        <div class="modal-close" id="modal-close">×</div>

        <h3>年月の選択</h3>

        ${years.map(y => `
          <div class="filter-block" data-year="${y}">
            <div class="filter-header">
              <span class="filter-label" data-year="${y}">${y}</span>
              <span class="filter-toggle-btn" data-year="${y}">▼</span>
            </div>
            <div class="filter-children">
              ${(months[y] || []).map(m => `
                <div class="select-item" data-ym="${y}-${m}">${m}</div>
              `).join("")}
            </div>
          </div>
        `).join("")}

        <div class="modal-footer">
          <button class="primary-btn" id="apply">適用</button>
          <button class="secondary-btn" id="clear">クリア</button>
        </div>
      </div>
    </div>
  `;

  openModal(html);
  initYearEvents();
}

function initYearEvents() {

  document.getElementById("modal-close").onclick = closeModal;
  document.getElementById("modal-bg").onclick = e => {
    if (e.target.classList.contains("modal-bg")) closeModal();
  };

  document.querySelectorAll(".filter-toggle-btn").forEach(btn => {
    btn.onclick = () => btn.closest(".filter-block").classList.toggle("open");
  });

  document.querySelectorAll("[data-ym]").forEach(el => {
    el.onclick = () => toggleYM(el.dataset.ym);
  });

  document.getElementById("clear").onclick = () => {
    filterState.yearMonths = [];
    updateYMSelections();
  };

  document.getElementById("apply").onclick = () => {
    applyFilter();
    closeModal();
  };

  updateYMSelections();
}

function toggleYM(ym) {
  if (filterState.yearMonths.includes(ym)) {
    filterState.yearMonths = filterState.yearMonths.filter(v => v !== ym);
  } else {
    filterState.yearMonths.push(ym);
  }
  updateYMSelections();
}

function updateYMSelections() {
  document.querySelectorAll("[data-ym]").forEach(el => {
    el.classList.toggle("selected", filterState.yearMonths.includes(el.dataset.ym));
  });
}
