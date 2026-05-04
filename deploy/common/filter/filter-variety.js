// common/filter/filter-variety.js
import { addFilterValue, removeFilterValue, getFilter } from "./filter-core.js";
import { closeModal } from "./filter-ui.js";

/* ============================================================
   品種フィルタモーダルを開く
============================================================ */
export function openVarietyModal(varietyData) {
  const container = document.getElementById("modal-container");
  container.innerHTML = createVarietyModalHTML(varietyData);
  container.style.display = "block";

  initVarietyModalEvents(varietyData);
}

/* ============================================================
   HTML 生成
============================================================ */
function createVarietyModalHTML(varietyData) {
  const parents = varietyData.parents;
  const children = varietyData.children;

  return `
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
}

/* ============================================================
   イベント設定
============================================================ */
function initVarietyModalEvents(varietyData) {

  document.getElementById("modal-close").addEventListener("click", closeModal);
  document.getElementById("modal-bg").addEventListener("click", (e) => {
    if (e.target.classList.contains("modal-bg")) closeModal();
  });

  document.querySelectorAll(".filter-toggle-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      btn.closest(".filter-block").classList.toggle("open");
    });
  });

  document.querySelectorAll(".filter-label").forEach(label => {
    label.addEventListener("click", () => toggleTypeAll(label.dataset.type, varietyData));
  });

  document.querySelectorAll("[data-variety]").forEach(el => {
    el.addEventListener("click", () => toggleVariety(el.dataset.variety));
  });

  document.getElementById("clear-variety").addEventListener("click", () => {
    const state = getFilter();
    state.varieties = [];
    updateVarietySelections();
  });

  document.getElementById("apply-variety").addEventListener("click", () => {
    closeModal();
  });

  updateVarietySelections();
}

/* ============================================================
   個別選択
============================================================ */
function toggleVariety(name) {
  const state = getFilter();

  if (state.varieties.includes(name)) {
    removeFilterValue("varieties", name);
  } else {
    addFilterValue("varieties", name);
  }
  updateVarietySelections();
}

/* ============================================================
   親（品種タイプ）全選択
============================================================ */
function toggleTypeAll(type, varietyData) {
  const list = varietyData.children[type] || [];
  const state = getFilter();
  const allSelected = list.every(v => state.varieties.includes(v));

  if (allSelected) {
    list.forEach(v => removeFilterValue("varieties", v));
  } else {
    list.forEach(v => addFilterValue("varieties", v));
  }

  updateVarietySelections();
}

/* ============================================================
   UI 更新
============================================================ */
function updateVarietySelections() {
  const state = getFilter();
  document.querySelectorAll("[data-variety]").forEach(el => {
    el.classList.toggle("selected", state.varieties.includes(el.dataset.variety));
  });
}
