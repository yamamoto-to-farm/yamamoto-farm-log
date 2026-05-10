// seedList-modal.js（filter-variety.js の新APIに対応）

import { openVarietyModal } from "/common/filter/filter-variety.js?v=1";

/* ===============================
   品種選択モーダル（カテゴリ対応）
=============================== */
export function openVarietySelectModal(onSelect) {
  openVarietyModal({
    mode: "select",
    onSelect: (name) => {
      onSelect({ name });
    }
  });
}

/* ===============================
   トレイ選択モーダル（seedList 専用）
=============================== */
export function openTrayTypeSelectModal(onSelect) {
  const modal = document.createElement("div");
  modal.className = "seed-modal-bg";

  modal.innerHTML = `
    <div class="seed-modal-content">
      <h2>トレイを選択</h2>

      <div class="seed-modal-item" data-type="128">128穴</div>
      <div class="seed-modal-item" data-type="200">200穴</div>

      <button id="closeTrayModal" class="secondary-btn" style="margin-top:12px;">閉じる</button>
    </div>
  `;

  document.body.appendChild(modal);

  modal.querySelectorAll(".seed-modal-item").forEach(item => {
    item.addEventListener("click", () => {
      onSelect(item.dataset.type);
      modal.remove();
    });
  });

  modal.querySelector("#closeTrayModal").addEventListener("click", () => {
    modal.remove();
  });
}

/* ===============================
   株間・畝間モーダル（seedList 専用）
=============================== */
export function openSpacingModal(row, onSelect) {
  const modal = document.createElement("div");
  modal.className = "seed-modal-bg";

  modal.innerHTML = `
    <div class="seed-modal-content">
      <h2>株間・畝間の設定</h2>

      <label>株間(cm)</label>
      <input type="number" id="spacingRowInput" value="${row.spacingRow || 34}" class="seed-modal-input">

      <label>畝間(cm)</label>
      <input type="number" id="spacingBedInput" value="${row.spacingBed || 60}" class="seed-modal-input">

      <div style="margin-top: 16px;">
        <button id="spacingOkBtn" class="primary-btn">OK</button>
        <button id="spacingCancelBtn" class="secondary-btn">キャンセル</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  modal.querySelector("#spacingOkBtn").addEventListener("click", () => {
    const spacingRow = Number(document.getElementById("spacingRowInput").value) || 0;
    const spacingBed = Number(document.getElementById("spacingBedInput").value) || 0;

    onSelect({ spacingRow, spacingBed });
    modal.remove();
  });

  modal.querySelector("#spacingCancelBtn").addEventListener("click", () => {
    modal.remove();
  });
}
