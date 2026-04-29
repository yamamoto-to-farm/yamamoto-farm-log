// ===============================
// list.js（一覧ページのモード管理）
// ===============================

import { renderPlantingList } from "./plantingList.js";
import { renderSeedList } from "./seedList.js";
import { setFilterData } from "/common/filter.js";

let currentMode = "planting";

export function initListPage() {

  const params = new URLSearchParams(location.search);
  const modeParam = params.get("mode");
  if (modeParam === "seed") currentMode = "seed";

  // ▼ ページ再読み込みしない高速モード切り替え
  document.getElementById("btn-planting").addEventListener("click", () => {
    if (currentMode === "planting") return;
    currentMode = "planting";
    history.replaceState(null, "", `${location.pathname}?mode=planting`);
    applyModeUI();
    renderCurrentMode();
  });

  document.getElementById("btn-seed").addEventListener("click", () => {
    if (currentMode === "seed") return;
    currentMode = "seed";
    history.replaceState(null, "", `${location.pathname}?mode=seed`);
    applyModeUI();
    renderCurrentMode();
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

    // ▼ 定植ベース用フィルタを再設定
    if (window.plantingFilterData) {
      setFilterData(window.plantingFilterData);
    }

  } else {
    renderSeedList();

    // ▼ 播種ベース用フィルタを再設定
    if (window.seedFilterData) {
      setFilterData(window.seedFilterData);
    }
  }
}

// ▼ フィルタ適用時は現在のモードを再描画
window.addEventListener("filter:apply", () => renderCurrentMode());
window.addEventListener("filter:reset", () => renderCurrentMode());
