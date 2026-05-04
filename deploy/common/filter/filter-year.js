// common/filter/filter-year.js
// 年 + 月フィルタ（旧 filter.js と互換）
// 親クリックで月を全選択／全解除に対応

import { filterState, getFilterData, applyFilter } from "./filter-core.js";
import { openModal, closeModal } from "./filter-ui.js";

/* ============================================================
   年フィルタモーダル
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
          <button class="primary-btn" id="apply-year">適用</button>
          <button class="secondary-btn" id="clear-year">クリア</button>
        </div>
      </div>
    </div>
  `;

  openModal(html);
  initYearEvents(months);
}

/* ============================================================
   イベント
============================================================ */
function initYearEvents(months) {

  document.getElementById("modal-close").onclick = closeModal;
  document.getElementById("modal-bg").onclick = e => {
    if (e.target.classList.contains("modal-bg")) closeModal();
  };

  // ▼ 親（年）折りたたみ
  document.querySelectorAll(".filter-toggle-btn").forEach(btn => {
    btn.onclick = () => btn.closest(".filter-block").classList.toggle("open");
  });

  // ▼ 親クリック → 月を全選択／全解除
  document.querySelectorAll(".filter-label").forEach(label => {
    label.onclick = () => toggleYearAll(label.dataset.year, months);
  });

  // ▼ 月クリック
  document.querySelectorAll("[data-ym]").forEach(el => {
    el.onclick = () => toggleYM(el.dataset.ym);
  });

  // ▼ クリア
  document.getElementById("clear-year").onclick = () => {
    filterState.yearMonths = [];
    updateYMSelections();
  };

  // ▼ 適用
  document.getElementById("apply-year").onclick = () => {
    applyFilter();
    closeModal();
  };

  updateYMSelections();
}

/* ============================================================
   月の個別選択
============================================================ */
function toggleYM(ym) {
  if (filterState.yearMonths.includes(ym)) {
    filterState.yearMonths = filterState.yearMonths.filter(v => v !== ym);
  } else {
    filterState.yearMonths.push(ym);
  }
  updateYMSelections();
}

/* ============================================================
   親クリック → 月を全選択／全解除
============================================================ */
function toggleYearAll(year, monthsMap) {
  const list = (monthsMap[year] || []).map(m => `${year}-${m}`);
  const allSelected = list.every(ym => filterState.yearMonths.includes(ym));

  if (allSelected) {
    // 全解除
    filterState.yearMonths = filterState.yearMonths.filter(ym => !list.includes(ym));
  } else {
    // 全選択
    list.forEach(ym => {
      if (!filterState.yearMonths.includes(ym)) {
        filterState.yearMonths.push(ym);
      }
    });
  }

  updateYMSelections();
}

/* ============================================================
   UI 更新
============================================================ */
function updateYMSelections() {
  document.querySelectorAll("[data-ym]").forEach(el => {
    el.classList.toggle("selected", filterState.yearMonths.includes(el.dataset.ym));
  });
}
