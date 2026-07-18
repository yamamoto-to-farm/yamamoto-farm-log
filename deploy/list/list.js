// ===============================
// list.js（一覧ページのモード管理）
// ===============================

import { renderPlantingList } from "./plantingList.js";
import { renderSeedList } from "./seedList.js";
import { setFilterData } from "/common/filter.js";
import { setupSmartBackButton } from "/common/navigation-back.js?v=1";

let currentMode = "planting";

export function initListPage() {
  setupSmartBackButton({
    elementId: "list-back-btn",
    fallbackPath: "/",
    defaultLabel: "元のページへ戻る"
  });

  const params = new URLSearchParams(location.search);
  const modeParam = params.get("mode");
  if (modeParam === "seed") currentMode = "seed";

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

  const sync = () => syncPrintHeader();
  window.addEventListener("beforeprint", sync);
  window.addEventListener("afterprint", sync);
}

function applyModeUI() {
  const btnPlanting = document.getElementById("btn-planting");
  const btnSeed = document.getElementById("btn-seed");

  btnPlanting.classList.toggle("active", currentMode === "planting");
  btnSeed.classList.toggle("active", currentMode === "seed");

  document.body.setAttribute("data-list-mode", currentMode);
}

function renderCurrentMode() {
  const tableArea = document.getElementById("table-area");
  tableArea.innerHTML = "";

  // ★ 現在のモードを filter.js / 各一覧JS に共有
  window.currentListMode = currentMode;

  if (currentMode === "planting") {
    renderPlantingList();
    if (window.plantingFilterData) setFilterData(window.plantingFilterData);
  } else {
    renderSeedList();
    if (window.seedFilterData) setFilterData(window.seedFilterData);
  }

  syncPrintHeader();
}

function syncPrintHeader() {
  const container = document.getElementById("print-header");
  if (!container) return;

  const title = document.querySelector(".hero-title")?.textContent?.trim() || "播種・定植一覧";
  const mode = currentMode === "planting" ? "定植" : "播種";
  const count = document.getElementById("countArea")?.textContent?.trim() || "-";
  const summaryHtml = document.getElementById("summaryArea")?.innerHTML?.trim() || "-";

  container.innerHTML = `
    <h1>${title}</h1>
    <p class="print-meta">モード: ${mode} / 表示件数: ${count}</p>
    <div class="print-summary">${summaryHtml}</div>
  `;
}

// ★ フィルタ適用時は再描画しない（各一覧JSが担当）
// window.addEventListener("filter:apply", () => renderCurrentMode());
// window.addEventListener("filter:reset", () => renderCurrentMode());
