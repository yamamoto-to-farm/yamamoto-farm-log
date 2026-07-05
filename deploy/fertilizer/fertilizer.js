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
import { setFilterData, getFilterData } from "/common/filter/filter-core.js?v=1";
import { initActiveFilterUI } from "/common/filter/filter-active.js?v=1";

import { setFertilizerDict, renderFertilizerInputs } 
  from "./fertilizer-multi-input.js?v=1";

import { 
  updateSelectedFieldsUI,
  updateSelectedFertilizersUI,
  saveFertilizerLog
} from "./fertilizer-utils.js?v=1";

const CROSS_PESTICIDE_CATEGORIES_FOR_FERTILIZER = ["土壌消毒剤"];

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

  /* ============================================================
     フィルタ変更時の UI 更新
  ============================================================ */
  window.addEventListener("filter:apply", async () => {
    await updateSelectedFieldsUI();
    updateSelectedFertilizersUI();   // ★ selected-fertilizer は更新しない
    renderFertilizerInputs();
  });

  window.addEventListener("filter:reset", async () => {
    await updateSelectedFieldsUI();
  });

  // 初期表示
  await updateSelectedFieldsUI();

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

  const [list, detail, pesticideList, pesticideDetail] = await Promise.all([
    fetch("/data/fertilizer/fertilizer-index.json?v=" + Date.now()).then(r => r.json()),
    fetch("/data/fertilizer/fertilizer-detail.json?v=" + Date.now())
      .then(r => (r.ok ? r.json() : {}))
      .catch(() => ({})),
    fetch("/data/pesticide/pesticide-index.json?v=" + Date.now())
      .then(r => (r.ok ? r.json() : []))
      .catch(() => ([])),
    fetch("/data/pesticide/pesticide-detail.json?v=" + Date.now())
      .then(r => (r.ok ? r.json() : {}))
      .catch(() => ({}))
  ]);

  // 辞書を作る（name → object）
  const dict = {};
  list.forEach(f => {
    const byId = detail?.[f.id] || {};
    dict[f.name] = {
      ...byId,
      ...f,
      id: f.id,
      name: f.name,
      category: f.category,
      unit: f.unit,
      materialType: "fertilizer",
      sourceMaster: "fertilizer-index"
    };
  });

  const crossTargets = Array.isArray(pesticideList)
    ? pesticideList.filter(v => CROSS_PESTICIDE_CATEGORIES_FOR_FERTILIZER.includes(String(v?.category || "").trim()))
    : [];

  crossTargets.forEach(f => {
    const byId = pesticideDetail?.[f.id] || {};
    const packUnit = String(byId?.packaging?.unit || f.unit || "kg").trim() || "kg";
    const amountPerPack = Number(byId?.packaging?.amountPerPack || 0);
    const capacityKg = packUnit.toLowerCase() === "g"
      ? amountPerPack / 1000
      : amountPerPack;

    dict[f.name] = {
      ...byId,
      ...f,
      id: f.id,
      name: f.name,
      category: f.category,
      capacity: Number.isFinite(capacityKg) && capacityKg > 0 ? capacityKg : 0,
      materialType: "pesticide",
      sourceMaster: "pesticide-index"
    };
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

  crossTargets.forEach(f => {
    if (!children[f.category]) {
      children[f.category] = [];
      parents.push(f.category);
    }
    if (!children[f.category].includes(f.name)) {
      children[f.category].push(f.name);
    }
  });

  const current = getFilterData();
  setFilterData({
    ...current,
    fertilizers: { parents, children }
  });

  debugLog("fertilizer filter set");
}
