// common/filter/filter-variety.js

import { filterState, getFilterData, applyFilter } from "./filter-core.js";
import { openModal, closeModal } from "./filter-ui.js";

/* ============================================================
   品種フィルタモーダル
============================================================ */
export function openVarietyModal() {
  const data = getFilterData().varieties;
  const parents = data.parents;
  const children = data.children;

  const html = `
    <div class="modal-bg" id="modal-bg">
      <div class="modal">
        <div class="modal-close" id="modal-close">×</div>

        <h3>品種の選択</h3>

        ${parents.map(type => `
          <div class="filter-block" data-type="${type}">
            <div class="filter-header">
              <span class="filter-label" data-type="${type}">${type}</span>
              <span class="filter-toggle-btn" data-type="${type}">▼</span>
            </div>
            <div class="filter-children">
              ${(children[type] || []).map(name => `
                <div class="select-item" data-variety="${name}">${name}</div>
              `).join("")}
            </div>
          </div>
        `).join("")}

        <div class="modal-footer">
          <button class="primary-btn" id="apply-variety">適用</button>
          <button class="secondary-btn" id="clear-variety">クリア</button>
        </div>
      </div>
    </div>
  `;

  openModal(html);
  initVarietyEvents(children);
}

/* ============================================================
   イベント
============================================================ */
function initVarietyEvents(children) {

  document.getElementById("modal-close").onclick = closeModal;
  document.getElementById("modal-bg").onclick = e => {
    if (e.target.classList.contains("modal-bg")) closeModal();
  };

  // ▼ 親折りたたみ
  document.querySelectorAll(".filter-toggle-btn").forEach(btn => {
    btn.onclick = () => btn.closest(".filter-block").classList.toggle("open");
  });

  // ▼ 親クリック → 子全選択／全解除
  document.querySelectorAll(".filter-label").forEach(label => {
    label.onclick = () => toggleTypeAll(label.dataset.type, children);
  });

  // ▼ 子クリック
  document.querySelectorAll("[data-variety]").forEach(el => {
    el.onclick = () => toggleVariety(el.dataset.variety);
  });

  // ▼ クリア
  document.getElementById("clear-variety").onclick = () => {
    filterState.varieties = [];
    updateVarietySelections();
  };

  // ▼ 適用
  document.getElementById("apply-variety").onclick = () => {
    applyFilter();
    closeModal();
  };

  updateVarietySelections();
}

/* ============================================================
   子の個別選択
============================================================ */
function toggleVariety(name) {
  if (filterState.varieties.includes(name)) {
    filterState.varieties = filterState.varieties.filter(v => v !== name);
  } else {
    filterState.varieties.push(name);
  }
  updateVarietySelections();
}

/* ============================================================
   親クリック → 子全選択／全解除
============================================================ */
function toggleTypeAll(type, childrenMap) {
  const list = childrenMap[type] || [];
  const allSelected = list.every(v => filterState.varieties.includes(v));

  if (allSelected) {
    filterState.varieties = filterState.varieties.filter(v => !list.includes(v));
  } else {
    list.forEach(v => {
      if (!filterState.varieties.includes(v)) {
        filterState.varieties.push(v);
      }
    });
  }

  updateVarietySelections();
}

/* ============================================================
   UI 更新
============================================================ */
function updateVarietySelections() {
  document.querySelectorAll("[data-variety]").forEach(el => {
    el.classList.toggle("selected", filterState.varieties.includes(el.dataset.variety));
  });
}
