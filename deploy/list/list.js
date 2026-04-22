// ===============================
// list.js（一覧ページのモード管理）
// ===============================

import { renderPlantingList } from "./plantingList.js";
import { renderSeedList } from "./seedList.js";

let currentMode = "planting";

export function initListPage() {

  // ▼ URL の mode を読む
  const params = new URLSearchParams(location.search);
  const modeParam = params.get("mode");
  if (modeParam === "seed") currentMode = "seed";

  // ▼ ボタン押下でページ遷移（?mode=xxx）
  document.getElementById("btn-planting").addEventListener("click", () => {
    location.href = `${location.pathname}?mode=planting`;
  });

  document.getElementById("btn-seed").addEventListener("click", () => {
    location.href = `${location.pathname}?mode=seed`;
  });

  // ▼ UI の active を反映
  applyModeUI();

  // ▼ 現在のモードの一覧を描画
  renderCurrentMode();
}

// ===============================
// active クラスで UI を切り替え
// ===============================
function applyModeUI() {
  const btnPlanting = document.getElementById("btn-planting");
  const btnSeed = document.getElementById("btn-seed");

  btnPlanting.classList.toggle("active", currentMode === "planting");
  btnSeed.classList.toggle("active", currentMode === "seed");
}

// ===============================
// モードに応じて一覧を描画
// ===============================
function renderCurrentMode() {
  const tableArea = document.getElementById("table-area");
  tableArea.innerHTML = "";

  if (currentMode === "planting") {
    renderPlantingList();
  } else {
    renderSeedList();
  }
}

// ===============================
// フィルタ適用時も現在モードを再描画
// ===============================
window.addEventListener("filter:apply", () => renderCurrentMode());
window.addEventListener("filter:reset", () => renderCurrentMode());
