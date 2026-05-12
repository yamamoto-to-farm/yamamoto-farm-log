// ===============================
// DOM が読み込まれるまで待つユーティリティ
// ===============================
async function waitForModalElements() {
  return new Promise(resolve => {
    const check = () => {
      const msg = document.getElementById("saveModalMessage");
      const btn = document.getElementById("saveModalCloseBtn");
      const modal = document.getElementById("saveModal");

      if (msg && btn && modal) {
        resolve();
      } else {
        requestAnimationFrame(check);
      }
    };
    check();
  });
}

// ===============================
// 保存モーダル表示
// ===============================
export async function showSaveModal(message = "保存中です…") {
  await waitForModalElements();

  document.getElementById("saveModalMessage").textContent = message;
  document.getElementById("saveModalCloseBtn").style.display = "none";
  document.getElementById("saveModal").style.display = "flex";
}

export async function updateSaveModal(message) {
  await waitForModalElements();
  document.getElementById("saveModalMessage").textContent = message;
}

export async function completeSaveModal(message = "保存が完了しました") {
  await waitForModalElements();

  document.getElementById("saveModalMessage").textContent = message;

  const btn = document.getElementById("saveModalCloseBtn");
  btn.style.display = "block";

  // ★ 保存モード：閉じたらリロード
  btn.onclick = () => {
    closeSaveModal();
    location.reload();
  };

  document.getElementById("saveModal").style.display = "flex";
}

export async function closeSaveModal() {
  await waitForModalElements();
  document.getElementById("saveModal").style.display = "none";
}

export async function completeAndCloseModal(message = "作業が完了しました") {
  await waitForModalElements();

  document.getElementById("saveModalMessage").textContent = message;

  const btn = document.getElementById("saveModalCloseBtn");
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

  document.getElementById("saveModal").style.display = "flex";
}
