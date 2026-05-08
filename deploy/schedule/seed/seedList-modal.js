// seedList-modal.js（filter-variety.js の新APIに対応）

import { openVarietyModal } from "/common/filter/filter-variety.js";

/* ===============================
   品種選択モーダル（annual-step2 と同じUI）
=============================== */
/* ===============================
   品種選択モーダル（カテゴリ対応）
=============================== */
export async function openVarietySelectModal(onSelect) {
  // ▼ varieties.json を読み込む
  const list = await fetch("/data/varieties.json").then(r => r.json());

  // ▼ 親カテゴリ一覧（type）を抽出
  const parents = [...new Set(list.map(v => v.type))];

  // ▼ seedList では初期選択なし
  const selected = [];

  // ▼ filter-variety.js の新APIに完全対応
  openVarietyModal({
    mode: "select",
    parents,
    selected,
    onSelect: (name) => {
      // ★ harvestMonth は seedList では使わない
      onSelect({ name });
    }
  });
}
/* ===============================
   トレイ選択モーダル（既存）
=============================== */
export function openTrayTypeSelectModal(onSelect) {
  const modal = document.createElement("div");
  modal.className = "modal-bg";

  modal.innerHTML = `
    <div class="modal-content">
      <h2>トレイを選択</h2>

      <div class="modal-item" data-type="128">128穴</div>
      <div class="modal-item" data-type="200">200穴</div>

      <button id="closeTrayModal" class="secondary-btn" style="margin-top:12px;">閉じる</button>
    </div>
  `;

  document.body.appendChild(modal);

  modal.querySelectorAll(".modal-item").forEach(item => {
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
   株間・畝間モーダル（既存）
=============================== */
export function openSpacingModal(row, onSelect) {
  const modal = document.createElement("div");
  modal.className = "modal-bg";

  modal.innerHTML = `
    <div class="modal-content">
      <h2>株間・畝間の設定</h2>

      <label>株間(cm)</label>
      <input type="number" id="spacingRowInput" value="${row.spacingRow || 34}" class="modal-input">

      <label>畝間(cm)</label>
      <input type="number" id="spacingBedInput" value="${row.spacingBed || 60}" class="modal-input">

      <div style="margin-top: 16px;">
        <button id="spacingOkBtn" class="primary-btn">OK</button>
        <button id="spacingCancelBtn" class="secondary-btn">キャンセル</button>
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
