// fertilizer.js

// ===============================
// デバッグフラグ
// ===============================
const DEBUG = true;   // ← false にすればログが一切出ない

function debugLog(...args) {
  if (DEBUG) console.log("[fertilizer-debug]", ...args);
}

import { openFieldModal } from "/common/filter/filter-field.js?v=1";
import { openFieldModal } from "/common/filter/filter-fertilizer.js?v=1";
import { setFilterData, filterState, getFilterData } from "/common/filter/filter-core.js?v=1";
import { initActiveFilterUI } from "/common/filter/filter-active.js?v=1";
import { saveMultiFieldLog } from "/common/general-log/base.js?v=1";

/* ============================================================
   初期化（フィルタ構造＋モーダル構造）
============================================================ */
export async function initFertilizerPage() {

  debugLog("initFertilizerPage start");

  // 1. フィルタデータ初期化
  await initFieldFilterData();

  // 2. タグ UI 初期化
  initActiveFilterUI();
  debugLog("active filter UI initialized");

  // 3. 圃場モーダル
  const btnField = document.getElementById("open-field-modal");
  if (btnField) {
    btnField.onclick = () => {
      debugLog("openFieldModal called");
      debugLog("getFilterData before openFieldModal:", getFilterData());
      openFieldModal({ mode: "filter" });
    };
  }

  // 4. 肥料モーダル
  const btnFertilizer = document.getElementById("open-fertilizer-modal");
  if (btnFertilizer) {
    btnFertilizer.onclick = () => {
      debugLog("openFertilizerModal called");
      debugLog("getFilterData before openFertilizerModal:", getFilterData());
      openFertilizerModal({ mode: "filter" }); // ★ mode を変えるだけでOK
    };
  }


  // 5. フィルタ変更時の表示更新
  window.addEventListener("filter:apply", () => {
    debugLog("filter:apply event", filterState.fields);
    updateSelectedFields();
  });

  window.addEventListener("filter:apply", () => {
    updateSelectedFertilizer();
  });

  window.addEventListener("filter:reset", () => {
    debugLog("filter:reset event");
    updateSelectedFields();
  });

  updateSelectedFields();

  // 6. 保存ボタン
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

  debugLog("fields.json loaded", fields);

  const parents = [];
  const children = {};

  fields.forEach(f => {
    if (!children[f.area]) {
      children[f.area] = [];
      parents.push(f.area);
    }
    children[f.area].push(f.name);
  });

  debugLog("filter parents", parents);
  debugLog("filter children", children);

  setFilterData({
    years: [],
    months: {},
    fields: { parents, children },
    varieties: { parents: [], children: {} }
  });

  debugLog("setFilterData completed");
  debugLog("getFilterData after setFilterData:", getFilterData());
}

/* ============================================================
   肥料フィルタデータ初期化
============================================================ */
async function initFertilizerFilterData() {
  debugLog("loading fertilizer-index.json");

  const res = await fetch("/data/fertilizer/fertilizer-index.json?v=" + Date.now());
  const list = await res.json();

  const parents = [];
  const children = {};

  list.forEach(f => {
    if (!children[f.category]) {
      children[f.category] = [];
      parents.push(f.category);
    }
    children[f.category].push(f.name);
  });

  debugLog("fertilizer parents", parents);
  debugLog("fertilizer children", children);

  // ★ 既存の filterState に肥料フィルタを追加
  const current = getFilterData();
  setFilterData({
    ...current,
    fertilizers: { parents, children }
  });
}

/* ============================================================
   選択圃場の表示更新
============================================================ */
function updateSelectedFields() {
  const fields = filterState.fields || [];
  debugLog("updateSelectedFields", fields);

  const el = document.getElementById("selected-fields");
  if (!el) return;

  el.textContent = fields.length ? fields.join("、") : "未選択";
}

/* ============================================================
   選択肥料の表示更新
============================================================ */
function updateSelectedFertilizers() {
  const fertilizers = filterState.fertilizers || [];
  debugLog("updateSelectedFertilizers", fertilizers);

  const el = document.getElementById("selected-fertilizers");
  if (!el) return;

  el.textContent = fertilizers.length ? fertilizers.join("、") : "未選択";
}

/* ============================================================
   保存処理
============================================================ */
async function saveData() {
  debugLog("saveData start");

  const date = document.getElementById("date").value;
  const fields = filterState.fields || [];
  const fertilizer_id = document.getElementById("fertilizer_id").value.trim();
  const bags = Number(document.getElementById("bags").value);
  const amountValue = Number(document.getElementById("amount").value);
  const machine = document.getElementById("machine").value.trim();
  const worker = document.getElementById("worker").value.trim();
  const notes = document.getElementById("notes").value.trim();

  debugLog("save payload", {
    date, fields, fertilizer_id, bags, amountValue, machine, worker, notes
  });

  if (!date || fields.length === 0 || !fertilizer_id) {
    alert("日付・圃場・肥料名は必須です");
    return;
  }

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
        fertilizer_id,
        bags,
        amount: { value: amountValue, unit: "kg" },
        machine,
        worker,
        notes
      }
    });

    debugLog("saveMultiFieldLog success");

    alert("保存しました！");
    document.getElementById("notes").value = "";

  } catch (e) {
    console.error(e);
    debugLog("saveMultiFieldLog error", e);
    alert("保存に失敗しました");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "保存";
    }
  }
}
