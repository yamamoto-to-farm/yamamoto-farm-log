// fertilizer.js（軽量化版）

// ===============================
// デバッグ
// ===============================
const DEBUG = true;
function debugLog(...args) {
  if (DEBUG) console.log("[fertilizer]", ...args);
}

import { openFieldModal } from "/common/filter/filter-field.js?v=1";
import { openFertilizerModal } from "/common/filter/filter-fertilizer.js?v=1";
import { setFilterData, filterState, getFilterData } from "/common/filter/filter-core.js?v=1";
import { initActiveFilterUI } from "/common/filter/filter-active.js?v=1";

import { setFertilizerDict, renderFertilizerInputs } 
  from "./fertilizer-multi-input.js?v=1";

import { 
  updateSelectedFieldsUI,
  updateSelectedFertilizersUI,
  saveFertilizerLog
} from "./fertilizer-utils.js?v=1";

/* ============================================================
   初期化（フィルタ構造＋モーダル構造）
============================================================ */
export async function initFertilizerPage() {

  debugLog("initFertilizerPage start");

  await initFieldFilterData();
  await initFertilizerFilterData();

  initActiveFilterUI();
  debugLog("active filter UI initialized");

  // 圃場モーダル
  const btnField = document.getElementById("open-field-modal");
  if (btnField) {
    btnField.onclick = () => {
      debugLog("openFieldModal");
      openFieldModal({ mode: "filter" });
    };
  }

  // 肥料モーダル
  const btnFertilizer = document.getElementById("open-fertilizer-modal");
  if (btnFertilizer) {
    btnFertilizer.onclick = () => {
      debugLog("openFertilizerModal");
      openFertilizerModal({ mode: "filter" });
    };
  }

  // フィルタ変更時の UI 更新
  window.addEventListener("filter:apply", () => {
    updateSelectedFieldsUI();
    updateSelectedFertilizersUI();
    renderFertilizerInputs();
  });

  window.addEventListener("filter:reset", () => {
    updateSelectedFieldsUI();
  });

  // 初期表示
  updateSelectedFieldsUI();

  // 保存ボタン
  const btnSave = document.getElementById("save-btn");
  if (btnSave) {
    btnSave.onclick = saveFertilizerLog;
  }

  debugLog("initFertilizerPage done");
}

/* ============================================================
   圃場フィルタデータ初期化
============================================================ */
async function initFieldFilterData() {
  debugLog("loading fields.json");

  const res = await fetch("/data/fields.json?v=" + Date.now());
  const fields = await res.json();

  const parents = [];
  const children = {};

  fields.forEach(f => {
    if (!children[f.area]) {
      children[f.area] = [];
      parents.push(f.area);
    }
    children[f.area].push(f.name);
  });

  setFilterData({
    years: [],
    months: {},
    fields: { parents, children },
    varieties: { parents: [], children: {} }
  });

  debugLog("fields filter set");
}

/* ============================================================
   肥料フィルタデータ初期化
============================================================ */
async function initFertilizerFilterData() {
  debugLog("loading fertilizer-index.json");

  const res = await fetch("/data/fertilizer/fertilizer-index.json?v=" + Date.now());
  const list = await res.json();

  // 辞書を作る（name → object）
  const dict = {};
  list.forEach(f => {
    dict[f.name] = f;
  });

  // multi-input に辞書を渡す
  setFertilizerDict(dict);

  const parents = [];
  const children = {};

  list.forEach(f => {
    if (!children[f.category]) {
      children[f.category] = [];
      parents.push(f.category);
    }
    children[f.category].push(f.name);
  });

  const current = getFilterData();
  setFilterData({
    ...current,
    fertilizers: { parents, children }
  });

  debugLog("fertilizer filter set");
}
