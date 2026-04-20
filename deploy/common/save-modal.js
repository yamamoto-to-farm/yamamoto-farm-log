export function showSaveModal(message = "保存中です…") {
  document.getElementById("saveModalMessage").textContent = message;
  document.getElementById("saveModalCloseBtn").style.display = "none";
  document.getElementById("saveModal").style.display = "flex";
}

export function updateSaveModal(message) {
  document.getElementById("saveModalMessage").textContent = message;
}

export function completeSaveModal(message = "保存が完了しました") {
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

export function closeSaveModal() {
  document.getElementById("saveModal").style.display = "none";
}

export function completeAndCloseModal(message = "作業が完了しました") {
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
        // → 閉じられていない（ブラウザで開いている）
        alert("ページを閉じられませんでした。\n右上のタブを閉じてください。");
      }
    }, 100);
  };

  document.getElementById("saveModal").style.display = "flex";
}
