// common/filter/filter-worker.js

import { openModal, closeModal, bindModalCloseEvents } from "./filter-core.js?v=1";

export function openWorkerSelectModal({ workers, selected, onApply }) {
  const selectedSet = new Set(selected || []);

  const html = `
    <div class="modal-bg" id="modal-bg">
      <div class="modal">
        <div class="modal-close" id="modal-close">×</div>

        <h3>作業者の選択</h3>

        <div class="filter-block open" data-worker-root="1">
          <div class="filter-children" style="display:flex; max-height:50vh; overflow-y:auto;">
            ${workers
              .filter(w => w && w.display)
              .map(w => {
                const name = escapeHtml(w.display);
                const selectedClass = selectedSet.has(w.display) ? " selected" : "";
                return `<div class="select-item${selectedClass}" data-worker="${name}">${name}</div>`;
              })
              .join("")}
          </div>
        </div>

        <div class="modal-footer">
          <button class="primary-btn" id="apply-worker">適用</button>
          <button class="secondary-btn" id="clear-worker">クリア</button>
        </div>
      </div>
    </div>
  `;

  openModal(html);
  initWorkerEvents(selectedSet, onApply);
}

function initWorkerEvents(selectedSet, onApply) {
  const applyBtn = document.getElementById("apply-worker");
  const clearBtn = document.getElementById("clear-worker");

  bindModalCloseEvents();

  document.querySelectorAll("[data-worker]").forEach(el => {
    el.onclick = () => {
      const name = el.dataset.worker;
      if (!name) return;

      if (selectedSet.has(name)) {
        selectedSet.delete(name);
        el.classList.remove("selected");
      } else {
        selectedSet.add(name);
        el.classList.add("selected");
      }
    };
  });

  if (clearBtn) {
    clearBtn.onclick = () => {
      selectedSet.clear();
      document.querySelectorAll("[data-worker].selected").forEach(el => {
        el.classList.remove("selected");
      });
    };
  }

  if (applyBtn) {
    applyBtn.onclick = () => {
      if (onApply) onApply(Array.from(selectedSet));
      closeModal();
    };
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
