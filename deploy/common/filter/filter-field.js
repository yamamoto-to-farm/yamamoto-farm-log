// common/filter/filter-field.js

import { filterState, getFilterData, applyFilter, openModal, closeModal } from "./filter-core.js?v=1";

/* ============================================================
   圃場フィルタモーダル（フィルタ／選択モード両対応）
============================================================ */
export function openFieldModal(options = {}) {
  const {
    mode = "filter",     // "filter"（従来） or "select"（STEP2 用）
    onSelect = null      // 選択モード時のコールバック
  } = options;

  // ★★★ 安全ガード（最重要）★★★
  const filter = getFilterData();
  console.log("[filter-field] getFilterData result:", filter);
  const data = filter?.fields || { parents: [], children: {} };
  const parents = data.parents || [];
  const children = data.children || {};

  const html = `
    <div class="modal-bg" id="modal-bg">
      <div class="modal">
        <div class="modal-close" id="modal-close">×</div>

        <h3>圃場の選択</h3>

        ${parents.map(area => `
          <div class="filter-block" data-area="${area}">
            <div class="filter-header">
              <span class="filter-label" data-area="${area}">${area}</span>
              <span class="filter-toggle-btn" data-area="${area}">▼</span>
            </div>
            <div class="filter-children">
              ${(children[area] || []).map(name => `
                <div class="select-item" data-field="${name}">${name}</div>
              `).join("")}
            </div>
          </div>
        `).join("")}

        ${
          mode === "filter"
            ? `
              <div class="modal-footer">
                <button class="primary-btn" id="apply-field">適用</button>
                <button class="secondary-btn" id="clear-field">クリア</button>
              </div>
            `
            : ""
        }
      </div>
    </div>
  `;

  openModal(html);
  initFieldEvents(children, mode, onSelect);
}

/* ============================================================
   イベント
============================================================ */
function initFieldEvents(children, mode, onSelect) {

  document.getElementById("modal-close").onclick = closeModal;
  document.getElementById("modal-bg").onclick = e => {
    if (e.target.classList.contains("modal-bg")) closeModal();
  };

  // ▼ 親（area）折りたたみ
  document.querySelectorAll(".filter-toggle-btn").forEach(btn => {
    btn.onclick = () => btn.closest(".filter-block").classList.toggle("open");
  });

  // ▼ 親クリック → 子全選択／全解除（フィルタモードのみ）
  if (mode === "filter") {
    document.querySelectorAll(".filter-label").forEach(label => {
      label.onclick = () => toggleAreaAll(label.dataset.area, children);
    });
  }

  // ▼ 子クリック
  document.querySelectorAll("[data-field]").forEach(el => {
    el.onclick = () => {
      const name = el.dataset.field;

      if (mode === "select") {
        // ★ 選択モード：即決定して閉じる
        if (onSelect) onSelect(name);
        closeModal();
        return;
      }

      // ★ フィルタモード：選択トグル
      toggleField(name);
    };
  });

  // ▼ フィルタモードのボタン
  if (mode === "filter") {
    document.getElementById("clear-field").onclick = () => {
      filterState.fields = [];
      updateFieldSelections();
    };

    document.getElementById("apply-field").onclick = () => {
      applyFilter();
      closeModal();
    };

    updateFieldSelections();
  }
}

/* ============================================================
   子の個別選択（フィルタモード）
============================================================ */
function toggleField(name) {
  if (filterState.fields.includes(name)) {
    filterState.fields = filterState.fields.filter(v => v !== name);
  } else {
    filterState.fields.push(name);
  }
  updateFieldSelections();
}

/* ============================================================
   親クリック → 子全選択／全解除（フィルタモード）
============================================================ */
function toggleAreaAll(area, childrenMap) {
  const list = childrenMap[area] || [];
  const allSelected = list.every(f => filterState.fields.includes(f));

  if (allSelected) {
    filterState.fields = filterState.fields.filter(f => !list.includes(f));
  } else {
    list.forEach(f => {
      if (!filterState.fields.includes(f)) {
        filterState.fields.push(f);
      }
    });
  }

  updateFieldSelections();
}

/* ============================================================
   UI 更新（フィルタモード）
============================================================ */
function updateFieldSelections() {
  document.querySelectorAll("[data-field]").forEach(el => {
    el.classList.toggle("selected", filterState.fields.includes(el.dataset.field));
  });
}
