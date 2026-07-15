// /common/fertilizer/fertilizer-utils.js

// ===============================
// デバッグ
// ===============================
const DEBUG = true;
function debugLog(...args) {
  if (DEBUG) console.log("[fertilizer-utils]", ...args);
}

import { filterState } from "/common/filter/filter-core.js?v=1";
import { getTotalFieldSize } from "/common/field-utils.js?v=1";
import { updatePer10aAll, getFertilizerInputData } 
  from "./fertilizer-multi-input.js?v=1";
import { distributeFertilizers } 
  from "./fertilizer-distribute.js?v=1";
import { saveMultiFieldLog } 
  from "/common/general-log/base.js?v=1";
import { showSaveModal, closeSaveModal, completeSaveModal, confirmSaveBeforeSubmit }
  from "/common/save-modal.js?v=1";
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
   肥料選択後の UI 更新
============================================================ */
export function updateSelectedFertilizersUI() {
    /*
  const fertilizers = filterState.fertilizers || [];
  const el = document.getElementById("selected-fertilizer");
  if (el) el.textContent = fertilizers.length ? fertilizers.join("、") : "未選択";
  */
}

/* ============================================================
   保存処理（複数肥料＋按分対応）
============================================================ */
export async function saveFertilizerLog() {
  debugLog("saveFertilizerLog start");

  const date = document.getElementById("date").value;
  const fields = filterState.fields || [];
  const notes = document.getElementById("notes").value.trim();

  // ★ 使用機械（harvest と同じく URL パラメータから取得）
  const machine = window.__fertilizer_machine || "machine1";

  // 作業者（収穫ログと同じ方式）
  const workers = getSelectedWorkers("workers_box", "temp_workers");

  if (!date || fields.length === 0) {
    alert("日付・圃場は必須です");
    return;
  }
  if (!String(workers || "").trim()) {
    alert("作業者は必須です");
    return;
  }

  const fertilizers = getFertilizerInputData();
  if (fertilizers.length === 0) {
    alert("肥料を選択してください");
    return;
  }

  const fieldsLabel = fields.length <= 4
    ? fields.join("、")
    : `${fields.slice(0, 4).join("、")} ほか${fields.length - 4}件`;
  const confirmed = await confirmSaveBeforeSubmit({
    lines: [
      `日付: ${date}`,
      `圃場: ${fieldsLabel}`,
      `作業者: ${workers}`,
      `肥料件数: ${fertilizers.length}件`
    ]
  });
  if (!confirmed) return;

  const distributed = await distributeFertilizers(fields, fertilizers);

  const btn = document.getElementById("save-btn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "保存中…";
  }
  showSaveModal("保存しています…");

  try {
    await saveMultiFieldLog({
      type: "fertilizer",
      date,
      fields,
      entry: {
        distributed,
        machine,
        workers,
        notes
      }
    });
    completeSaveModal("保存が完了しました");

    document.getElementById("notes").value = "";

  } catch (e) {
    closeSaveModal();
    console.error(e);
    alert(e?.message || "保存に失敗しました");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "保存";
    }
  }
}
