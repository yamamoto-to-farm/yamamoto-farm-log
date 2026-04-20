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

  // ★ 作業完了モード：閉じたら window.close()
  btn.onclick = () => {
    closeSaveModal();
    window.close();
  };

  document.getElementById("saveModal").style.display = "flex";
}
