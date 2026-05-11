// fertilizer.js

// ===============================
// デバッグフラグ
// ===============================
const DEBUG = true;

function debugLog(...args) {
  if (DEBUG) console.log("[fertilizer-debug]", ...args);
}

import { openFieldModal } from "/common/filter/filter-field.js?v=1";
import { openFertilizerModal } from "/common/filter/filter-fertilizer.js?v=1";
import { setFilterData, filterState, getFilterData } from "/common/filter/filter-core.js?v=1";
import { initActiveFilterUI } from "/common/filter/filter-active.js?v=1";
import { saveMultiFieldLog } from "/common/general-log/base.js?v=1";

import { setFertilizerDict, renderFertilizerInputs, getFertilizerInputData } 
  from "./fertilizer-multi-input.js?v=1";

import { distributeFertilizers } 
  from "./fertilizer-distribute.js?v=1";

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
      debugLog("openFieldModal called");
      openFieldModal({ mode: "filter" });
    };
  }

  // 肥料モーダル
  const btnFertilizer = document.getElementById("open-fertilizer-modal");
  if (btnFertilizer) {
    btnFertilizer.onclick = () => {
      debugLog("openFertilizerModal called");
      openFertilizerModal({ mode: "filter" });
    };
  }

  // フィルタ変更時の表示更新
  window.addEventListener("filter:apply", () => {
    updateSelectedFields();
  });

  window.addEventListener("filter:apply", () => {
    updateSelectedFertilizers();
    renderFertilizerInputs();   // ★ 複数肥料入力欄を描画
  });

  window.addEventListener("filter:reset", () => {
    updateSelectedFields();
  });

  updateSelectedFields();

  // 保存ボタン
  const btnSave = document.getElementById("save-btn");
  if (btnSave) {
    btnSave.onclick = saveData;
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

/* ============================================================
   選択圃場の表示更新
============================================================ */
function updateSelectedFields() {
  const fields = filterState.fields || [];
  const el = document.getElementById("selected-fields");
  if (!el) return;

  el.textContent = fields.length ? fields.join("、") : "未選択";
}

/* ============================================================
   選択肥料の表示更新
============================================================ */
function updateSelectedFertilizers() {
  const fertilizers = filterState.fertilizers || [];
  const el = document.getElementById("selected-fertilizer");
  if (!el) return;

  el.textContent = fertilizers.length ? fertilizers.join("、") : "未選択";
}

/* ============================================================
   保存処理（複数肥料＋按分対応）
============================================================ */
async function saveData() {
  debugLog("saveData start");

  const date = document.getElementById("date").value;
  const fields = filterState.fields || [];
  const machine = document.getElementById("machine").value.trim();
  const worker = document.getElementById("worker").value.trim();
  const notes = document.getElementById("notes").value.trim();

  if (!date || fields.length === 0) {
    alert("日付・圃場は必須です");
    return;
  }

  // ★ multi-input から複数肥料データを取得
  const fertilizers = getFertilizerInputData();
  debugLog("fertilizers from UI:", fertilizers);

  if (fertilizers.length === 0) {
    alert("肥料を選択してください");
    return;
  }

  // ★ 面積比で按分（施肥専用ロジック）
  const distributed = await distributeFertilizers(fields, fertilizers);
  debugLog("distributed:", distributed);

  const btn = document.getElementById("save-btn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "保存中…";
  }

  try {
    await saveMultiFieldLog({
      type: "fertilizer",
      date,
      fields,
      entry: {
        distributed,   // ★ 圃場ごとの施肥量
        machine,
        worker,
        notes
      }
    });

    alert("保存しました！");
    document.getElementById("notes").value = "";

  } catch (e) {
    console.error(e);
    alert("保存に失敗しました");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "保存";
    }
  }
}
