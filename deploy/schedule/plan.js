// plan.js

import { openYearSelectModal } from "/common/filter/filter-year-simple.js";
import { loadJSON } from "/common/json.js";
import { setSeedRowsFromAnnual } from "./seed/seedList-state.js";
import { renderSeedList } from "./seed/index.js";
import { renderPlantingList } from "./plantingList.js";
import { setFilterData } from "/common/filter.js";

let currentMode = "seed";
let selectedYear = null;

/* ============================================================
   年度選択 → annual.json 読み込み → seedList 初期行生成
============================================================ */
export function initAnnualLinkage() {
  const btn = document.getElementById("selectYearBtn");
  const label = document.getElementById("selectedYearLabel");

  btn.addEventListener("click", async () => {
    const annualAll = await loadJSON("/logs/schedule/annual/annual.json");
    const years = Object.keys(annualAll).sort();

    openYearSelectModal({
      years,
      onSelect: async (y) => {
        selectedYear = y;
        label.textContent = `${y} 年`;

        const step2 = annualAll[y]?.step2;
        if (step2?.rows) {
          await setSeedRowsFromAnnual(step2.rows);
        }

        if (currentMode === "seed") {
          renderSeedList();
        }
      }
    });
  });
}

/* ============================================================
   モード切り替え
============================================================ */
export function initListPage() {
  const params = new URLSearchParams(location.search);
  const modeParam = params.get("mode");
  if (modeParam === "planting") currentMode = "planting";
  else currentMode = "seed";

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
    if (window.plantingFilterData) {
      setFilterData(window.plantingFilterData);
    }
  } else {
    renderSeedList();
  }
}

window.addEventListener("filter:apply", () => {
  if (currentMode === "planting") renderCurrentMode();
});
window.addEventListener("filter:reset", () => {
  if (currentMode === "planting") renderCurrentMode();
});
