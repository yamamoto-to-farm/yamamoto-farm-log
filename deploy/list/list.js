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

  document.getElementById("btn-planting").addEventListener("click", () => switchMode("planting"));
  document.getElementById("btn-seed").addEventListener("click", () => switchMode("seed"));

  applyModeUI();
  renderCurrentMode();
}

function switchMode(mode) {
  if (currentMode === mode) return;

  currentMode = mode;

  const newUrl = `${location.pathname}?mode=${mode}`;
  history.replaceState(null, "", newUrl);

  applyModeUI();
  renderCurrentMode();
}

function applyModeUI() {
  const btnPlanting = document.getElementById("btn-planting");
  const btnSeed = document.getElementById("btn-seed");

  if (currentMode === "planting") {
    btnPlanting.classList.add("primary-btn");
    btnSeed.classList.remove("primary-btn");
    btnSeed.classList.add("secondary-btn");
  } else {
    btnSeed.classList.add("primary-btn");
    btnPlanting.classList.remove("primary-btn");
    btnPlanting.classList.add("secondary-btn");
  }
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
