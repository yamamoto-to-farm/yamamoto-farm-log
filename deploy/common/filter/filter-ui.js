// common/filter/filter-ui.js

export function closeModal() {
  const container = document.getElementById("modal-container");
  if (!container) return;
  container.innerHTML = "";
  container.style.display = "none";
}

export function openModal(html) {
  let container = document.getElementById("modal-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "modal-container";
    document.body.appendChild(container);
  }
  container.innerHTML = html;
  container.style.display = "block";
}
