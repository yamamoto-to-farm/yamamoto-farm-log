// fertilizer.js

const DEBUG = true;
function debugLog(...args) {
  if (DEBUG) console.log("[fertilizer-debug]", ...args);
}

import { openFieldModal } from "/common/filter/filter-field.js?v=2";
import { setFilterData, filterState } from "/common/filter/filter-core.js?v=2";
import { initActiveFilterUI } from "/common/filter/filter-active.js?v=1";
import { saveMultiFieldLog } from "/common/general-log/base.js?v=1";

/* ============================================================
   初期化
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
      openFieldModal({ mode: "filter" });

      // ★ モーダル開いた直後に同期（保険）
      setTimeout(updateSelectedFields, 50);
    };
  }

  // 4. フィルタ変更イベント
  document.addEventListener("filter:apply", () => {
    debugLog("filter:apply event", filterState.fields);
    updateSelectedFields();
  });

  document.addEventListener("filter:reset", () => {
    debugLog("filter:reset event");
    updateSelectedFields();
  });

  updateSelectedFields();

  // 5. 保存ボタン
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
