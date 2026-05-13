// common/filter/filter-pesticide.js

import { filterState, getFilterData, applyFilter, openModal, closeModal } from "./filter-core.js?v=1";

/* ============================================================
   農薬フィルタモーダル（フィルタ／選択モード両対応）
============================================================ */
export function openpesticideModal(options = {}) {
  const {
    mode = "filter",
    onSelect = null
  } = options;

  const filter = getFilterData();
  const data = filter?.pesticides || { parents: [], children: {} };
  const parents = data.parents || [];
  const children = data.children || {};

  const html = `
    <div class="modal-bg" id="modal-bg">
      <div class="modal">
        <div class="modal-close" id="modal-close">×</div>

        <h3>農薬の選択</h3>

        ${parents.map(cat => `
          <div class="filter-block" data-cat="${cat}">
            <div class="filter-header">
              <span class="filter-label" data-cat="${cat}">${cat}</span>
              <span class="filter-toggle-btn" data-cat="${cat}">▼</span>
            </div>
            <div class="filter-children">
              ${(children[cat] || []).map(name => `
                <div class="select-item" data-pesticide="${name}">${name}</div>
              `).join("")}
            </div>
          </div>
        `).join("")}

        ${
          mode === "filter"
            ? `
              <div class="modal-footer">
                <button class="primary-btn" id="apply-pesticide">適用</button>
                <button class="secondary-btn" id="clear-pesticide">クリア</button>
              </div>
            `
            : ""
        }
      </div>
    </div>
  `;

  openModal(html);
  initpesticideEvents(children, mode, onSelect);
}

/* ============================================================
   イベント
============================================================ */
function initpesticideEvents(children, mode, onSelect) {

  document.getElementById("modal-close").onclick = closeModal;
  document.getElementById("modal-bg").onclick = e => {
    if (e.target.classList.contains("modal-bg")) closeModal();
  };

  // ▼ 親カテゴリ折りたたみ
  document.querySelectorAll(".filter-toggle-btn").forEach(btn => {
    btn.onclick = () => btn.closest(".filter-block").classList.toggle("open");
  });

  // ▼ 子クリック
  document.querySelectorAll("[data-pesticide]").forEach(el => {
    el.onclick = () => {
      const name = el.dataset.pesticide;

      if (mode === "select") {
        if (onSelect) onSelect(name);
        closeModal();
        return;
      }

      togglepesticide(name);
    };
  });

  if (mode === "filter") {
    document.getElementById("clear-pesticide").onclick = () => {
      filterState.pesticides = [];
      updatepesticideSelections();
    };

    document.getElementById("apply-pesticide").onclick = () => {
      applyFilter();
      closeModal();
    };

    updatepesticideSelections();
  }
}

/* ============================================================
   個別選択（フィルタモード）
============================================================ */
function togglepesticide(name) {
  if (filterState.pesticides.includes(name)) {
    filterState.pesticides = filterState.pesticides.filter(v => v !== name);
  } else {
    filterState.pesticides.push(name);
  }
  updatepesticideSelections();
}

/* ============================================================
   UI 更新（フィルタモード）
============================================================ */
function updatepesticideSelections() {
  document.querySelectorAll("[data-pesticide]").forEach(el => {
    el.classList.toggle("selected",
      filterState.pesticides.includes(el.dataset.pesticide)
    );
  });
}
