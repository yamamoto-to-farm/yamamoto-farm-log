// common/filter/filter-variety.js

import { filterState, getFilterData, applyFilter } from "./filter-core.js";
import { openModal, closeModal } from "./filter-ui.js";

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

function initVarietyEvents(children) {

  document.getElementById("modal-close").onclick = closeModal;
  document.getElementById("modal-bg").onclick = e => {
    if (e.target.classList.contains("modal-bg")) closeModal();
  };

  document.querySelectorAll(".filter-toggle-btn").forEach(btn => {
    btn.onclick = () => btn.closest(".filter-block").classList.toggle("open");
  });

  document.querySelectorAll("[data-variety]").forEach(el => {
    el.onclick = () => toggleVariety(el.dataset.variety);
  });

  document.getElementById("clear-variety").onclick = () => {
    filterState.varieties = [];
    updateVarietySelections();
  };

  document.getElementById("apply-variety").onclick = () => {
    applyFilter();
    closeModal();
  };

  updateVarietySelections();
}

function toggleVariety(name) {
  if (filterState.varieties.includes(name)) {
    filterState.varieties = filterState.varieties.filter(v => v !== name);
  } else {
    filterState.varieties.push(name);
  }
  updateVarietySelections();
}

function updateVarietySelections() {
  document.querySelectorAll("[data-variety]").forEach(el => {
    el.classList.toggle("selected", filterState.varieties.includes(el.dataset.variety));
  });
}
