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
  document.getElementById("saveModalCloseBtn").style.display = "block";
}

export function closeSaveModal() {
  document.getElementById("saveModal").style.display = "none";
}

window.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("saveModalCloseBtn");
  if (btn) {
    btn.addEventListener("click", () => {
      closeSaveModal();
      location.reload();   // ← ここでリロード（planting/harvest共通）
    });
  }
});
