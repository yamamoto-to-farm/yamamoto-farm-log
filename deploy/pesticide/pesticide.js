// pesticide.js（軽量化版）

// ===============================
// デバッグ
// ===============================
const DEBUG = true;
function debugLog(...args) {
  if (DEBUG) console.log("[pesticide]", ...args);
}

import { openFieldModal } from "/common/filter/filter-field.js?v=1";
import { openpesticideModal } from "/common/filter/filter-pesticide.js?v=1";
import { setFilterData, getFilterData } from "/common/filter/filter-core.js?v=1";
import { initActiveFilterUI } from "/common/filter/filter-active.js?v=1";

import { setpesticideDict, renderpesticideInputs } 
  from "./pesticide-multi-input.js?v=1";

import { 
  updateSelectedFieldsUI,
  updateSelectedpesticidesUI,
  savepesticideLog
} from "./pesticide-utils.js?v=1";

const CROSS_FERTILIZER_CATEGORIES_FOR_PESTICIDE = ["液肥", "葉面散布剤", "BS資材"];

/* ============================================================
   初期化（フィルタ構造＋モーダル構造）
============================================================ */
export async function initpesticidePage() {

  debugLog("initpesticidePage start");

  await initFieldFilterData();
  await initpesticideFilterData();

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

  // 農薬モーダル
  const btnpesticide = document.getElementById("open-pesticide-modal");
  if (btnpesticide) {
    btnpesticide.onclick = () => {
      debugLog("openpesticideModal");
      openpesticideModal({ mode: "filter" });
    };
  }

  /* ============================================================
     フィルタ変更時の UI 更新
  ============================================================ */
  window.addEventListener("filter:apply", async () => {
    await updateSelectedFieldsUI();
    updateSelectedpesticidesUI();   // ★ selected-pesticide は更新しない
    renderpesticideInputs();
  });

  window.addEventListener("filter:reset", async () => {
    await updateSelectedFieldsUI();
  });

  // 初期表示
  await updateSelectedFieldsUI();

  // 保存ボタン
  const btnSave = document.getElementById("save-btn");
  if (btnSave) {
    btnSave.onclick = savepesticideLog;
  }

  debugLog("initpesticidePage done");
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
   農薬フィルタデータ初期化
============================================================ */
async function initpesticideFilterData() {
  debugLog("loading pesticide-index.json");

  const [list, detail, fertilizerList, fertilizerDetail] = await Promise.all([
    fetch("/data/pesticide/pesticide-index.json?v=" + Date.now()).then(r => r.json()),
    fetch("/data/pesticide/pesticide-detail.json?v=" + Date.now())
      .then(r => (r.ok ? r.json() : {}))
      .catch(() => ({})),
    fetch("/data/fertilizer/fertilizer-index.json?v=" + Date.now())
      .then(r => (r.ok ? r.json() : []))
      .catch(() => ([])),
    fetch("/data/fertilizer/fertilizer-detail.json?v=" + Date.now())
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
      materialType: "pesticide",
      sourceMaster: "pesticide-index"
    };
  });

  const crossTargets = Array.isArray(fertilizerList)
    ? fertilizerList.filter(v => CROSS_FERTILIZER_CATEGORIES_FOR_PESTICIDE.includes(String(v?.category || "").trim()))
    : [];

  crossTargets.forEach(f => {
    const byId = fertilizerDetail?.[f.id] || {};
    const unit = String(byId?.packaging?.unit || byId?.unit || "ml").trim() || "ml";
    dict[f.name] = {
      ...byId,
      ...f,
      id: f.id,
      name: f.name,
      category: f.category,
      unit,
      materialType: "fertilizer",
      sourceMaster: "fertilizer-index"
    };
  });

  // multi-input に辞書を渡す
  setpesticideDict(dict);

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
    pesticides: { parents, children }
  });

  debugLog("pesticide filter set");
}
