// common/filter/filter-field.js
import { addFilterValue, removeFilterValue, getFilter } from "./filter-core.js";
import { closeModal } from "./filter-ui.js";

/* ============================================================
   圃場フィルタモーダルを開く
============================================================ */
export function openFieldModal(fieldData) {
  const container = document.getElementById("modal-container");
  container.innerHTML = createFieldModalHTML(fieldData);
  container.style.display = "block";

  initFieldModalEvents(fieldData);
}

/* ============================================================
   HTML 生成
============================================================ */
function createFieldModalHTML(fieldData) {
  const parents = fieldData.parents;
  const children = fieldData.children;

  return `
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

        <div class="modal-footer">
          <button class="primary-btn" id="apply-field">適用</button>
          <button class="secondary-btn" id="clear-field">クリア</button>
        </div>
      </div>
    </div>
  `;
}

/* ============================================================
   イベント設定
============================================================ */
function initFieldModalEvents(fieldData) {

  document.getElementById("modal-close").addEventListener("click", closeModal);
  document.getElementById("modal-bg").addEventListener("click", (e) => {
    if (e.target.classList.contains("modal-bg")) closeModal();
  });

  // 親（エリア）折りたたみ
  document.querySelectorAll(".filter-toggle-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      btn.closest(".filter-block").classList.toggle("open");
    });
  });

  // 親（エリア）全選択
  document.querySelectorAll(".filter-label").forEach(label => {
    label.addEventListener("click", () => toggleAreaAll(label.dataset.area, fieldData));
  });

  // 個別選択
  document.querySelectorAll("[data-field]").forEach(el => {
    el.addEventListener("click", () => toggleField(el.dataset.field));
  });

  // クリア
  document.getElementById("clear-field").addEventListener("click", () => {
    const state = getFilter();
    state.fields = [];
    updateFieldSelections();
  });

  // 適用
  document.getElementById("apply-field").addEventListener("click", () => {
    closeModal();
  });

  updateFieldSelections();
}

/* ============================================================
   個別選択
============================================================ */
function toggleField(name) {
  const state = getFilter();

  if (state.fields.includes(name)) {
    removeFilterValue("fields", name);
  } else {
    addFilterValue("fields", name);
  }
  updateFieldSelections();
}

/* ============================================================
   親（エリア）全選択
============================================================ */
function toggleAreaAll(area, fieldData) {
  const list = fieldData.children[area] || [];
  const state = getFilter();
  const allSelected = list.every(f => state.fields.includes(f));

  if (allSelected) {
    list.forEach(f => removeFilterValue("fields", f));
  } else {
    list.forEach(f => addFilterValue("fields", f));
  }

  updateFieldSelections();
}

/* ============================================================
   UI 更新
============================================================ */
function updateFieldSelections() {
  const state = getFilter();
  document.querySelectorAll("[data-field]").forEach(el => {
    el.classList.toggle("selected", state.fields.includes(el.dataset.field));
  });
}
