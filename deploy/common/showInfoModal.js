// ===============================
// showInfoModal.js（共通：情報モーダル）
// ===============================

export function showInfoModal(title, contentHtml) {
  // 既存モーダルがあれば削除
  const old = document.getElementById("info-modal-bg");
  if (old) old.remove();

  const bg = document.createElement("div");
  bg.id = "info-modal-bg";
  bg.className = "modal-bg";

  const modal = document.createElement("div");
  modal.className = "modal";

  modal.innerHTML = `
    <div class="modal-close" id="info-modal-close">×</div>
    <h2 class="section-title">${title}</h2>
    <div class="modal-content">
      ${contentHtml}
    </div>
    <div class="modal-footer">
      <button class="primary-btn" id="info-modal-ok">OK</button>
    </div>
  `;

  bg.appendChild(modal);
  document.body.appendChild(bg);

  // 閉じる処理
  document.getElementById("info-modal-close").onclick = () => bg.remove();
  document.getElementById("info-modal-ok").onclick = () => bg.remove();
}
