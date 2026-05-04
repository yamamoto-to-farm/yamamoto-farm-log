// ===============================
// list.js（一覧ページのモード管理）
// ===============================

import { renderPlantingList } from "./plantingList.js";
import { renderSeedList } from "./seed/index.js";   // ← 修正ポイント
import { setFilterData } from "/common/filter.js";

let currentMode = "seed";

export function initListPage() {

  const params = new URLSearchParams(location.search);
  const modeParam = params.get("mode");
  if (modeParam === "planting") currentMode = "planting";
  else currentMode = "seed";

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

  // ▼ seed モードではフィルタ UI を非表示（seedList はフィルタ未実装）
  const filterCard = document.getElementById("filter-card");
  const activeFilters = document.getElementById("activeFilters");

  if (currentMode === "seed") {
    filterCard.style.display = "none";
    activeFilters.style.display = "none";
  } else {
    filterCard.style.display = "";
    activeFilters.style.display = "";
  }
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

    // ▼ seed モードはフィルタ未実装なので何もしない
    // （将来 seedFilterData を作るならここで setFilterData を呼ぶ）
  }
}

// ▼ フィルタ適用時は現在のモードを再描画（planting のみ有効）
window.addEventListener("filter:apply", () => {
  if (currentMode === "planting") renderCurrentMode();
});
window.addEventListener("filter:reset", () => {
  if (currentMode === "planting") renderCurrentMode();
});
