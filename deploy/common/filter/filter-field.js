// common/filter/filter-field.js

import { filterState, getFilterData, applyFilter } from "./filter-core.js";
import { openModal, closeModal } from "./filter-ui.js";

export function openFieldModal() {
  const data = getFilterData().fields;
  const parents = data.parents;
  const children = data.children;

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

        <div class="modal-footer">
          <button class="primary-btn" id="apply-field">適用</button>
          <button class="secondary-btn" id="clear-field">クリア</button>
        </div>
      </div>
    </div>
  `;

  openModal(html);
  initFieldEvents(children);
}

function initFieldEvents(children) {

  document.getElementById("modal-close").onclick = closeModal;
  document.getElementById("modal-bg").onclick = e => {
    if (e.target.classList.contains("modal-bg")) closeModal();
  };

  document.querySelectorAll(".filter-toggle-btn").forEach(btn => {
    btn.onclick = () => btn.closest(".filter-block").classList.toggle("open");
  });

  document.querySelectorAll("[data-field]").forEach(el => {
    el.onclick = () => toggleField(el.dataset.field);
  });

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

function toggleField(name) {
  if (filterState.fields.includes(name)) {
    filterState.fields = filterState.fields.filter(v => v !== name);
  } else {
    filterState.fields.push(name);
  }
  updateFieldSelections();
}

function updateFieldSelections() {
  document.querySelectorAll("[data-field]").forEach(el => {
    el.classList.toggle("selected", filterState.fields.includes(el.dataset.field));
  });
}
