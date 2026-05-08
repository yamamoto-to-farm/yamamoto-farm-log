// plan.js

import { openYearSelectModal } from "/common/filter/filter-year-simple.js";
import { loadJSON } from "/common/json.js";

import { setSeedRowsFromAnnual } from "./seed/seedList-state.js";
import { renderSeedList } from "./seed/index.js";
import { renderPlantingList } from "./plantingList.js";
import { setFilterData } from "/common/filter.js";

import {
  loadSeedListFromCSV,
  loadSeedListFromJSON,
  getCurrentYear
} from "./seed/seedList-load.js";

import { saveSeedList } from "./seed/seedList-save.js";

let currentMode = "seed";
let selectedYear = null;

/* ============================================================
   seedList 用：品種フィルタデータ初期化
   （annual.js と同等の varieties.parents / children をセット）
============================================================ */
async function initSeedListFilter() {
  try {
    const varieties = await loadJSON("/data/varieties.json");

    const typeMap = {};
    const typeOrder = [];

    varieties.forEach(v => {
      if (!typeMap[v.type]) {
        typeMap[v.type] = [];
        typeOrder.push(v.type);
      }
      typeMap[v.type].push(v.name);
    });

    // seedList では fields / years / months は使わないので空で渡す
    setFilterData({
      years: [],
      months: {},
      fields: { parents: [], children: {} },
      varieties: { parents: typeOrder, children: typeMap }
    });

  } catch (e) {
    console.error("[seedList] フィルタ用 varieties データ初期化失敗:", e);
  }
}

/* ============================================================
   年度選択 → annual.json 読み込み → seedList 初期行生成
   ＋ 年度ごと CSV があれば CSV を優先ロード
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

        // ▼ 年度を UI に反映（seedList-load.js が参照）
        const yearSelect = document.getElementById("yearSelect");
        if (yearSelect) yearSelect.value = y;

        // ▼ まず CSV を試す
        const ok = await loadSeedListFromCSV(y);

        if (!ok) {
          // ▼ CSV が無ければ annual.json → STEP2 初期生成
          const step2 = annualAll[y]?.step2;
          if (step2?.rows) {
            await setSeedRowsFromAnnual(step2.rows);
          }
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
export async function initListPage() {

  // ★ 最重要：filter-core.js に varieties データをセット
  await initSeedListFilter();

  const params = new URLSearchParams(location.search);
  const modeParam = params.get("mode");
  currentMode = (modeParam === "planting") ? "planting" : "seed";

  // ▼ JSON 読み込みボタン
  const btnJson = document.getElementById("loadJsonBtn");
  if (btnJson) {
    btnJson.onclick = async () => {
      const year = getCurrentYear();
      if (!year) {
        alert("年度を選択してください。");
        return;
      }
      if (!confirm(`${year}年の播種計画を annual.json から再生成します。現在の内容は上書きされます。`)) {
        return;
      }
      await loadSeedListFromJSON(year);
      renderSeedList();
    };
  }

  // ▼ CSV 読み込みボタン
  const btnCsv = document.getElementById("loadCsvBtn");
  if (btnCsv) {
    btnCsv.onclick = async () => {
      const year = getCurrentYear();
      if (!year) {
        alert("年度を選択してください。");
        return;
      }
      const ok = await loadSeedListFromCSV(year);
      if (!ok) {
        alert(`${year}年の CSV が見つかりませんでした。`);
      } else {
        renderSeedList();
      }
    };
  }

  // ▼ CSV 保存ボタン
  const btnSave = document.getElementById("saveCsvBtn");
  if (btnSave) {
    btnSave.onclick = () => {
      saveSeedList();
    };
  }

  // ▼ モード切り替え
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

/* ============================================================
   UI 切り替え（seed 専用 UI を完全分離）
============================================================ */
function applyModeUI() {
  const btnPlanting = document.getElementById("btn-planting");
  const btnSeed = document.getElementById("btn-seed");

  btnPlanting.classList.toggle("active", currentMode === "planting");
  btnSeed.classList.toggle("active", currentMode === "seed");

  const filterCard = document.getElementById("filter-card");
  const activeFilters = document.getElementById("activeFilters");

  // ▼ 播種計画専用コントロール（CSV/JSON 読み込み・保存）
  const seedControls = document.getElementById("seedList-controls");
  if (seedControls) {
    seedControls.style.display = (currentMode === "seed") ? "flex" : "none";
  }

  // ▼ 育苗ハウス容量カード
  const capacityCard = document.getElementById("capacity-card");
  if (capacityCard) {
    capacityCard.style.display = (currentMode === "seed") ? "" : "none";
  }

  // ▼ サマリーカード（容量チェック）
  const summaryCard = document.getElementById("summary-card");
  if (summaryCard) {
    summaryCard.style.display = (currentMode === "seed") ? "" : "none";
  }

  // ▼ フィルタ（定植計画専用）
  if (currentMode === "seed") {
    filterCard.style.display = "none";
    activeFilters.style.display = "none";
  } else {
    filterCard.style.display = "";
    activeFilters.style.display = "";
  }
}

/* ============================================================
   モードごとの描画
============================================================ */
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

/* ============================================================
   フィルタイベント
============================================================ */
window.addEventListener("filter:apply", () => {
  if (currentMode === "planting") renderCurrentMode();
});
window.addEventListener("filter:reset", () => {
  if (currentMode === "planting") renderCurrentMode();
});
