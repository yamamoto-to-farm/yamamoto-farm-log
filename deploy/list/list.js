// ===============================
// list.js（一覧ページのモード管理）
// ===============================

import { renderPlantingList } from "./plantingList.js";
import { renderSeedList } from "./seedList.js";

let currentMode = "planting";

export function initListPage() {

  const params = new URLSearchParams(location.search);
  const modeParam = params.get("mode");
  if (modeParam === "seed") currentMode = "seed";

  document.getElementById("btn-planting").addEventListener("click", () => {
    location.href = `${location.pathname}?mode=planting`;
  });

  document.getElementById("btn-seed").addEventListener("click", () => {
    location.href = `${location.pathname}?mode=seed`;
  });

  applyModeUI();
  renderCurrentMode();
}

function applyModeUI() {
  const btnPlanting = document.getElementById("btn-planting");
  const btnSeed = document.getElementById("btn-seed");

  btnPlanting.classList.toggle("active", currentMode === "planting");
  btnSeed.classList.toggle("active", currentMode === "seed");
}

function renderCurrentMode() {
  const tableArea = document.getElementById("table-area");
  tableArea.innerHTML = "";

  if (currentMode === "planting") {
    renderPlantingList();
  } else {
    renderSeedList();
  }
}

window.addEventListener("filter:apply", () => renderCurrentMode());
window.addEventListener("filter:reset", () => renderCurrentMode());
