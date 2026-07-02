// /common/pesticide/pesticide-utils.js

// ===============================
// デバッグ
// ===============================
const DEBUG = true;
function debugLog(...args) {
  if (DEBUG) console.log("[pesticide-utils]", ...args);
}

import { filterState } from "/common/filter/filter-core.js?v=1";
import { getTotalFieldSize } from "/common/field-utils.js?v=1";
import { updatePer10aAll, getpesticideInputData } 
  from "./pesticide-multi-input.js?v=1";
import { distributepesticides } 
  from "./pesticide-distribute.js?v=1";
import { savePesticideLog } 
  from "/common/general-log/pesticide.js?v=1";
import { getSelectedWorkers } 
  from "/common/ui.js?v=1";

/* ============================================================
   圃場選択後の UI 更新（合計面積＋/10a）
============================================================ */
export async function updateSelectedFieldsUI() {
  const fields = filterState.fields || [];

  const el = document.getElementById("selected-fields");
  if (el) el.textContent = fields.length ? fields.join("、") : "未選択";

  const totalA = await getTotalFieldSize(fields);
  const areaEl = document.getElementById("field-area-total");
  if (areaEl) areaEl.textContent = `合計面積：${totalA.toFixed(1)} a`;

  updatePer10aAll(totalA);

  debugLog("updateSelectedFieldsUI done:", { fields, totalA });
}

/* ============================================================
  農薬選択後の UI 更新
============================================================ */
export function updateSelectedpesticidesUI() {
    /*
  const pesticides = filterState.pesticides || [];
  const el = document.getElementById("selected-pesticide");
  if (el) el.textContent = pesticides.length ? pesticides.join("、") : "未選択";
  */
}

/* ============================================================
  保存処理（複数農薬＋按分対応）
============================================================ */
export async function savepesticideLog() {
  debugLog("savepesticideLog start");

  const date = document.getElementById("date").value;
  const fields = filterState.fields || [];
  const notes = document.getElementById("notes").value.trim();

  // ★ 使用機械（harvest と同じく URL パラメータから取得）
  const machine = window.__pesticide_machine || "machine1";

  // 作業者（収穫ログと同じ方式）
  const workers = getSelectedWorkers("workers_box", "temp_workers");

  if (!date || fields.length === 0) {
    alert("日付・圃場は必須です");
    return;
  }

  const pesticides = getpesticideInputData();
  if (pesticides.length === 0) {
    alert("農薬の希釈倍率・合計散布水量を入力してください");
    return;
  }

  const distributed = await distributepesticides(fields, pesticides);

  const btn = document.getElementById("save-btn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "保存中…";
  }

  try {
    await savePesticideLog({
      date,
      fields,
      distributed,
      machine,
      workers,
      notes
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
