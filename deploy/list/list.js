// ===============================
// list.js（一覧ページのモード管理）
// ===============================

import { renderPlantingList } from "./plantingList.js";
import { renderSeedList } from "./seedList.js";

// 現在のモード（planting / seed）
let currentMode = "planting";

/* ============================================================
   初期化（list.html → initListPage()）
============================================================ */
export function initListPage() {

  // ▼ URL パラメータで mode 指定があれば反映
  const params = new URLSearchParams(location.search);
  const modeParam = params.get("mode");
  if (modeParam === "seed") currentMode = "seed";

  // ▼ ボタンのイベント設定
  document.getElementById("btn-planting").addEventListener("click", () => switchMode("planting"));
  document.getElementById("btn-seed").addEventListener("click", () => switchMode("seed"));

  // ▼ 初期モードの描画
  applyModeUI();
  renderCurrentMode();
}

/* ============================================================
   モード切り替え
============================================================ */
function switchMode(mode) {
  if (currentMode === mode) return;

  currentMode = mode;

  // URL を書き換え（履歴は残さない）
  const newUrl = `${location.pathname}?mode=${mode}`;
  history.replaceState(null, "", newUrl);

  applyModeUI();
  renderCurrentMode();
}

/* ============================================================
   モードに応じて UI を更新
============================================================ */
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

/* ============================================================
   モードに応じて一覧を描画
============================================================ */
function renderCurrentMode() {
  const tableArea = document.getElementById("table-area");
  tableArea.innerHTML = ""; // いったんクリア

  if (currentMode === "planting") {
    renderPlantingList();   // plantingList.js が table-area に描画
  } else {
    renderSeedList();       // seedList.js が table-area に描画
  }
}

/* ============================================================
   フィルタ適用イベント（filter.js → dispatch）
============================================================ */
window.addEventListener("filter:apply", () => {
  renderCurrentMode();
});

window.addEventListener("filter:reset", () => {
  renderCurrentMode();
});
