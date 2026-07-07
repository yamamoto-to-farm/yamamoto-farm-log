// common/filter/filter-machine.js

import {
  filterState,
  getFilterData,
  applyFilter,
  openModal,
  closeModal,
  bindModalCloseEvents
} from "./filter-core.js?v=1";

export function openMachineModal(options = {}) {
  const { mode = "filter", onSelect = null } = options;

  const filter = getFilterData();
  const data = filter?.machines || { parents: [], children: {} };
  const parents = data.parents || [];
  const children = data.children || {};

  const html = `
    <div class="modal-bg" id="modal-bg">
      <div class="modal">
        <div class="modal-close" id="modal-close">×</div>

        <h3>機械の選択</h3>

        ${parents.map(group => `
          <div class="filter-block" data-group="${group}">
            <div class="filter-header">
              <span class="filter-label" data-group="${group}">${group}</span>
              <span class="filter-toggle-btn" data-group="${group}">▼</span>
            </div>
            <div class="filter-children">
              ${(children[group] || []).map(name => `
                <div class="select-item" data-machine="${name}">${name}</div>
              `).join("")}
            </div>
          </div>
        `).join("")}

        ${
          mode === "filter"
            ? `
              <div class="modal-footer">
                <button class="primary-btn" id="apply-machine">適用</button>
                <button class="secondary-btn" id="clear-machine">クリア</button>
              </div>
            `
            : ""
        }
      </div>
    </div>
  `;

  openModal(html);
  initMachineEvents(children, mode, onSelect);
}

function initMachineEvents(children, mode, onSelect) {
  bindModalCloseEvents();

  document.querySelectorAll(".filter-toggle-btn").forEach(btn => {
    btn.onclick = () => btn.closest(".filter-block").classList.toggle("open");
  });

  if (mode === "filter") {
    document.querySelectorAll(".filter-label").forEach(label => {
      label.onclick = () => toggleGroupAll(label.dataset.group, children);
    });
  }

  document.querySelectorAll("[data-machine]").forEach(el => {
    el.onclick = () => {
      const name = el.dataset.machine;

      if (mode === "select") {
        if (onSelect) onSelect(name);
        closeModal();
        return;
      }

      toggleMachine(name);
    };
  });

  if (mode === "filter") {
    const clearBtn = document.getElementById("clear-machine");
    if (clearBtn) {
      clearBtn.onclick = () => {
        filterState.machines = [];
        updateMachineSelections();
      };
    }

    const applyBtn = document.getElementById("apply-machine");
    if (applyBtn) {
      applyBtn.onclick = () => {
        applyFilter();
        closeModal();
      };
    }

    updateMachineSelections();
  }
}

function toggleMachine(name) {
  if (filterState.machines.includes(name)) {
    filterState.machines = filterState.machines.filter(v => v !== name);
  } else {
    filterState.machines.push(name);
  }
  updateMachineSelections();
}

function toggleGroupAll(group, childrenMap) {
  const list = childrenMap[group] || [];
  const allSelected = list.every(v => filterState.machines.includes(v));

  if (allSelected) {
    filterState.machines = filterState.machines.filter(v => !list.includes(v));
  } else {
    list.forEach(v => {
      if (!filterState.machines.includes(v)) {
        filterState.machines.push(v);
      }
    });
  }

  updateMachineSelections();
}

function updateMachineSelections() {
  document.querySelectorAll("[data-machine]").forEach(el => {
    el.classList.toggle("selected", filterState.machines.includes(el.dataset.machine));
  });
}
