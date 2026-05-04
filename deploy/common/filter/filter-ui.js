// common/filter/filter-ui.js

export function closeModal() {
  const container = document.getElementById("modal-container");
  if (!container) return;

  container.innerHTML = "";
  container.style.display = "none";
}
