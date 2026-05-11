// common/filter/filter-fertilizer.js

import { filterState, getFilterData, applyFilter, openModal, closeModal } from "./filter-core.js?v=1";

/* ============================================================
   肥料フィルタモーダル（フィルタ／選択モード両対応）
============================================================ */
export function openFertilizerModal(options = {}) {
  const {
    mode = "filter",
    onSelect = null
  } = options;

  const filter = getFilterData();
  const data = filter?.fertilizers || { parents: [], children: {} };
  const parents = data.parents || [];
  const children = data.children || {};

  const html = `
    <div class="modal-bg" id="modal-bg">
      <div class="modal">
        <div class="modal-close" id="modal-close">×</div>

        <h3>肥料の選択</h3>

        ${parents.map(cat => `
          <div class="filter-block" data-cat="${cat}">
            <div class="filter-header">
              <span class="filter-label" data-cat="${cat}">${cat}</span>
              <span class="filter-toggle-btn" data-cat="${cat}">▼</span>
            </div>
            <div class="filter-children">
              ${(children[cat] || []).map(name => `
                <div class="select-item" data-fertilizer="${name}">${name}</div>
              `).join("")}
            </div>
          </div>
        `).join("")}

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
  initFertilizerEvents(children, mode, onSelect);
}

/* ============================================================
   イベント
============================================================ */
function initFertilizerEvents(children, mode, onSelect) {

  document.getElementById("modal-close").onclick = closeModal;
  document.getElementById("modal-bg").onclick = e => {
    if (e.target.classList.contains("modal-bg")) closeModal();
  };

  // ▼ 親カテゴリ折りたたみ
  document.querySelectorAll(".filter-toggle-btn").forEach(btn => {
    btn.onclick = () => btn.closest(".filter-block").classList.toggle("open");
  });

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
