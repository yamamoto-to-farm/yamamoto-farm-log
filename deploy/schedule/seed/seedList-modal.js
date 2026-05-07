// seedList-modal.js

/* ===============================
   モーダル共通：背景生成
=============================== */
function createModalBase() {
  const modal = document.createElement("div");
  modal.className = "modal-bg";
  return modal;
}

/* ===============================
   品種選択モーダル
=============================== */
export function openVarietySelectModal(onSelect) {
  const modal = createModalBase();

  modal.innerHTML = `
    <div class="modal-content">
      <h2>品種を選択</h2>
      <div id="varietyList" class="modal-list"></div>
      <button id="closeVarietyModal" class="secondary-btn" style="margin-top:12px;">閉じる</button>
    </div>
  `;

  document.body.appendChild(modal);

  // 品種データ読み込み
  fetch("/data/varieties.json")
    .then(res => res.json())
    .then(list => {
      const area = modal.querySelector("#varietyList");
      area.innerHTML = list
        .map(v => `<div class="modal-item" data-name="${v.name}">${v.name}</div>`)
        .join("");

      area.querySelectorAll(".modal-item").forEach(item => {
        item.addEventListener("click", () => {
          const name = item.dataset.name;
          onSelect({ name });
          modal.remove();
        });
      });
    });

  modal.querySelector("#closeVarietyModal").addEventListener("click", () => {
    modal.remove();
  });
}

/* ===============================
   トレイ選択モーダル
=============================== */
export function openTrayTypeSelectModal(onSelect) {
  const modal = createModalBase();

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
   株間・畝間モーダル（★ 新規追加）
=============================== */
export function openSpacingModal(row, onSelect) {
  const modal = createModalBase();

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
