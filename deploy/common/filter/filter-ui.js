// common/filter/filter-ui.js

export function closeModal() {
  const container = document.getElementById("modal-container");
  if (!container) return;
  container.innerHTML = "";
  container.style.display = "none";
}

export function openModal(html) {
  const container = document.getElementById("modal-container");
  container.innerHTML = html;
  container.style.display = "block";
}
