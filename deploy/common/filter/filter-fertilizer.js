// common/filter/filter-fertilizer.js

import { filterState, getFilterData, applyFilter, openModal, closeModal } from "./filter-core.js?v=1";

/* ============================================================
   肥料フィルタモーダル（フィルタ／選択モード両対応）
============================================================ */
export function openFertilizerModal(options = {}) {
  const {
    mode = "filter",     // "filter" or "select"
    onSelect = null
  } = options;

  const filter = getFilterData();
  const list = filter?.fertilizers || [];

  const html = `
    <div class="modal-bg" id="modal-bg">
      <div class="modal">
        <div class="modal-close" id="modal-close">×</div>

        <h3>肥料の選択</h3>

        <div class="filter-children">
          ${list.map(name => `
            <div class="select-item" data-fertilizer="${name}">
              ${name}
            </div>
          `).join("")}
        </div>

        ${
          mode === "filter"
            ? `
              <div class="modal-footer">
                <button class="primary-btn" id="apply-fertilizer">適用</button>
                <button class="secondary-btn" id="clear-fertilizer">クリア</button>
              </div>
            `
            : ""
        }
      </div>
    </div>
  `;

  openModal(html);
  initFertilizerEvents(mode, onSelect);
}

/* ============================================================
   イベント
============================================================ */
function initFertilizerEvents(mode, onSelect) {

  document.getElementById("modal-close").onclick = closeModal;
  document.getElementById("modal-bg").onclick = e => {
    if (e.target.classList.contains("modal-bg")) closeModal();
  };

  // ▼ 子クリック
  document.querySelectorAll("[data-fertilizer]").forEach(el => {
    el.onclick = () => {
      const name = el.dataset.fertilizer;

      if (mode === "select") {
        if (onSelect) onSelect(name);
        closeModal();
        return;
      }

      toggleFertilizer(name);
    };
  });

  if (mode === "filter") {
    document.getElementById("clear-fertilizer").onclick = () => {
      filterState.fertilizers = [];
      updateFertilizerSelections();
    };

    document.getElementById("apply-fertilizer").onclick = () => {
      applyFilter();
      closeModal();
    };

    updateFertilizerSelections();
  }
}

/* ============================================================
   個別選択（フィルタモード）
============================================================ */
function toggleFertilizer(name) {
  if (filterState.fertilizers.includes(name)) {
    filterState.fertilizers = filterState.fertilizers.filter(v => v !== name);
  } else {
    filterState.fertilizers.push(name);
  }
  updateFertilizerSelections();
}

/* ============================================================
   UI 更新（フィルタモード）
============================================================ */
function updateFertilizerSelections() {
  document.querySelectorAll("[data-fertilizer]").forEach(el => {
    el.classList.toggle("selected",
      filterState.fertilizers.includes(el.dataset.fertilizer)
    );
  });
}
