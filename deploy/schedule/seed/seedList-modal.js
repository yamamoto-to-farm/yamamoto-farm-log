// schedule/seed/seedList-modal.js

import { getVarietyData } from "./seedList-state.js";

export function closeModal() {
  const container = document.getElementById("modal-container");
  container.style.display = "none";
  container.innerHTML = "";
}

export function openVarietySelectModal(callback) {
  const container = document.getElementById("modal-container");
  container.style.display = "block";

  const varietyData = getVarietyData();
  const typeMap = {};

  varietyData.forEach(v => {
    if (!typeMap[v.type]) typeMap[v.type] = [];
    typeMap[v.type].push(v);
  });

  let listHtml = "";
  Object.keys(typeMap).forEach(type => {
    listHtml += `<h4 class="variety-type-title">${type}</h4>`;
    typeMap[type].forEach(v => {
      listHtml += `<div class="variety-option" data-name="${v.name}" data-type="${v.type}">${v.name}</div>`;
    });
  });

  container.innerHTML = `
    <div class="modal-bg" id="variety-modal-bg">
      <div class="modal small-modal">
        <div class="modal-close" id="variety-modal-close">×</div>
        <h3>品種選択</h3>
        <div class="variety-select-list">${listHtml}</div>
      </div>
    </div>
  `;

  document.getElementById("variety-modal-close").onclick = closeModal;
  document.getElementById("variety-modal-bg").onclick = e => {
    if (e.target.id === "variety-modal-bg") closeModal();
  };

  document.querySelectorAll(".variety-option").forEach(opt => {
    opt.addEventListener("click", () => {
      callback({ name: opt.dataset.name, type: opt.dataset.type });
      closeModal();
    });
  });
}

export function openTrayTypeSelectModal(callback) {
  const container = document.getElementById("modal-container");
  container.style.display = "block";

  container.innerHTML = `
    <div class="modal-bg" id="tray-modal-bg">
      <div class="modal small-modal">
        <div class="modal-close" id="tray-modal-close">×</div>
        <h3>トレイタイプ選択</h3>
        <div class="tray-select-list">
          <div class="tray-option" data-type="128">128穴（標準）</div>
          <div class="tray-option" data-type="200">200穴（密植）</div>
        </div>
      </div>
    </div>
  `;

  document.getElementById("tray-modal-close").onclick = closeModal;
  document.getElementById("tray-modal-bg").onclick = e => {
    if (e.target.id === "tray-modal-bg") closeModal();
  };

  document.querySelectorAll(".tray-option").forEach(opt => {
    opt.addEventListener("click", () => {
      callback(opt.dataset.type);
      closeModal();
    });
  });
}

export function openHarvestMonthModal(callback) {
  const container = document.getElementById("modal-container");
  container.style.display = "block";

  let listHtml = "";
  for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, "0");
    listHtml += `<div class="month-option" data-mm="${mm}">${m}月</div>`;
  }

  container.innerHTML = `
    <div class="modal-bg" id="month-modal-bg">
      <div class="modal small-modal">
        <div class="modal-close" id="month-modal-close">×</div>
        <h3>収穫予定月</h3>
        <div class="month-select-list">${listHtml}</div>
      </div>
    </div>
  `;

  document.getElementById("month-modal-close").onclick = closeModal;
  document.getElementById("month-modal-bg").onclick = e => {
    if (e.target.id === "month-modal-bg") closeModal();
  };

  document.querySelectorAll(".month-option").forEach(opt => {
    opt.addEventListener("click", () => {
      callback(opt.dataset.mm);
      closeModal();
    });
  });
}
export function openSpacingModal(row, onSelect) {
  const modal = document.createElement("div");
  modal.className = "modal-bg";

  modal.innerHTML = `
    <div class="modal-content">
      <h2>株間・畝間の設定</h2>

      <label>株間(cm)</label>
      <input type="number" id="spacingRowInput" value="${row.spacingRow || 34}">

      <label>畝間(cm)</label>
      <input type="number" id="spacingBedInput" value="${row.spacingBed || 60}">

      <div style="margin-top: 16px;">
        <button id="spacingOkBtn" class="primary-btn">OK</button>
        <button id="spacingCancelBtn">キャンセル</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  modal.querySelector("#spacingOkBtn").addEventListener("click", () => {
    const spacingRow = Number(modal.querySelector("#spacingRowInput").value) || 0;
    const spacingBed = Number(modal.querySelector("#spacingBedInput").value) || 0;

    onSelect({ spacingRow, spacingBed });
    modal.remove();
  });

  modal.querySelector("#spacingCancelBtn").addEventListener("click", () => {
    modal.remove();
  });
}
