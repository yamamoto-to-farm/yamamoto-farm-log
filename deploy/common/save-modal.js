let blockingEnabled = false;

function ensureModalElements() {
  let modal = document.getElementById("saveModal");
  let msg = document.getElementById("saveModalMessage");
  let btn = document.getElementById("saveModalCloseBtn");

  if (modal && msg && btn) {
    return { modal, msg, btn };
  }

  const host = document.createElement("div");
  host.innerHTML = `
    <div id="saveModal" style="
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.4);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 9999;
    ">
      <div style="
        background: white;
        padding: 20px;
        border-radius: 8px;
        width: 300px;
        text-align: center;
      ">
        <div id="saveModalMessage">保存中です…</div>
        <button id="saveModalCloseBtn" style="margin-top: 20px; display:none;">OK</button>
      </div>
    </div>
  `;
  document.body.appendChild(host);

  modal = document.getElementById("saveModal");
  msg = document.getElementById("saveModalMessage");
  btn = document.getElementById("saveModalCloseBtn");

  return { modal, msg, btn };
}

function preventKeyInputWhileBlocking(e) {
  if (!blockingEnabled) return;
  e.preventDefault();
  e.stopPropagation();
}

function enableUiBlocking() {
  if (blockingEnabled) return;
  blockingEnabled = true;

  const blocker = document.createElement("div");
  blocker.id = "saveUiBlocker";
  blocker.style.position = "fixed";
  blocker.style.top = "0";
  blocker.style.left = "0";
  blocker.style.right = "0";
  blocker.style.bottom = "0";
  blocker.style.background = "transparent";
  blocker.style.zIndex = "9998";
  blocker.style.cursor = "wait";
  blocker.style.pointerEvents = "auto";

  document.body.appendChild(blocker);
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
  window.addEventListener("keydown", preventKeyInputWhileBlocking, true);
}

function disableUiBlocking() {
  blockingEnabled = false;
  const blocker = document.getElementById("saveUiBlocker");
  blocker?.remove();
  window.removeEventListener("keydown", preventKeyInputWhileBlocking, true);
}

// ===============================
// 保存モーダル表示
// ===============================
export async function showSaveModal(message = "保存中です…") {
  enableUiBlocking();
  const { modal, msg, btn } = ensureModalElements();
  msg.textContent = message;
  btn.style.display = "none";
  modal.style.display = "flex";
}

export async function updateSaveModal(message) {
  const { msg } = ensureModalElements();
  msg.textContent = message;
}

export async function completeSaveModal(message = "保存が完了しました") {
  enableUiBlocking();
  const { modal, msg, btn } = ensureModalElements();
  msg.textContent = message;
  btn.style.display = "block";

  // ★ 保存モード：閉じたらリロード
  btn.onclick = () => {
    closeSaveModal();
    location.reload();
  };

  modal.style.display = "flex";
}

export async function closeSaveModal() {
  const { modal } = ensureModalElements();
  modal.style.display = "none";
  disableUiBlocking();
}

export async function completeAndCloseModal(message = "作業が完了しました") {
  enableUiBlocking();
  const { modal, msg, btn } = ensureModalElements();
  msg.textContent = message;
  btn.style.display = "block";

  btn.onclick = () => {
    closeSaveModal();

    // ★ タブを閉じようとする
    window.close();

    // ★ 100ms 後に「閉じられたか」をチェック
    setTimeout(() => {
      if (!document.hidden) {
        alert("ページを閉じられませんでした。\n右上のタブを閉じてください。");
      }
    }, 100);
  };

  modal.style.display = "flex";
}
