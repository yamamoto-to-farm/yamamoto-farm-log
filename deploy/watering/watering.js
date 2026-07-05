// watering/watering.js

const DEBUG = true;
function debugLog(...args) {
  if (DEBUG) console.log("[watering]", ...args);
}

import { openFieldModal } from "/common/filter/filter-field.js?v=1";
import { setFilterData, getFilterData, filterState } from "/common/filter/filter-core.js?v=1";
import { initActiveFilterUI } from "/common/filter/filter-active.js?v=1";
import { getTotalFieldSize } from "/common/field-utils.js?v=1";
import { getSelectedWorkers } from "/common/ui.js?v=1";
import { saveMultiFieldLog } from "/common/general-log/base.js?v=1";
import { showSaveModal, closeSaveModal, completeSaveModal } from "/common/save-modal.js?v=1";

export async function initWateringPage() {
  debugLog("initWateringPage start");

  await initFieldFilterData();

  initActiveFilterUI();

  const btnField = document.getElementById("open-field-modal");
  if (btnField) {
    btnField.onclick = () => {
      openFieldModal({ mode: "filter" });
    };
  }

  window.addEventListener("filter:apply", async () => {
    await updateSelectedFieldsUI();
  });

  window.addEventListener("filter:reset", async () => {
    await updateSelectedFieldsUI();
  });

  await updateSelectedFieldsUI();

  const btnSave = document.getElementById("save-btn");
  if (btnSave) {
    btnSave.onclick = saveWateringLog;
  }

  debugLog("initWateringPage done");
}

async function initFieldFilterData() {
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

  const current = getFilterData();
  setFilterData({
    ...current,
    fields: { parents, children }
  });
}

async function updateSelectedFieldsUI() {
  const fields = filterState.fields || [];

  const el = document.getElementById("selected-fields");
  if (el) el.textContent = fields.length ? fields.join("、") : "未選択";

  const totalA = await getTotalFieldSize(fields);
  const areaEl = document.getElementById("field-area-total");
  if (areaEl) areaEl.textContent = `合計面積：${totalA.toFixed(1)} a`;
}

function parseTimeToMinutes(value) {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) return null;
  const [hh, mm] = value.split(":").map(Number);
  return hh * 60 + mm;
}

function calcDurationMinutes(startTime, endTime) {
  const start = parseTimeToMinutes(startTime);
  const end = parseTimeToMinutes(endTime);
  if (start === null || end === null) return null;

  const diff = end - start;
  if (diff >= 0) return diff;

  return (24 * 60) + diff;
}

async function saveWateringLog() {
  const date = document.getElementById("date")?.value || "";
  const startTime = document.getElementById("start-time")?.value || "";
  const endTime = document.getElementById("end-time")?.value || "";
  const durationInput = Number(document.getElementById("duration-min")?.value || 0);
  const notes = (document.getElementById("notes")?.value || "").trim();
  const fields = filterState.fields || [];
  const workers = getSelectedWorkers("workers_box", "temp_workers");
  const machine = window.__watering_machine || "";

  let irrigationMinutes = 0;
  if (durationInput > 0) {
    irrigationMinutes = durationInput;
  } else {
    const autoMinutes = calcDurationMinutes(startTime, endTime);
    irrigationMinutes = autoMinutes || 0;
  }

  if (!date || fields.length === 0 || irrigationMinutes <= 0) {
    alert("作業日・圃場・潅水時間（分 or 開始終了時刻）は必須です");
    return;
  }
  if (!String(workers || "").trim()) {
    alert("作業者は必須です");
    return;
  }

  const btn = document.getElementById("save-btn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "保存中…";
  }
  showSaveModal("保存しています…");

  try {
    await saveMultiFieldLog({
      type: "watering",
      date,
      fields,
      entry: {
        workType: "潅水",
        startTime,
        endTime,
        irrigationMinutes,
        machine,
        workers,
        notes
      }
    });
    completeSaveModal("保存が完了しました");

    const notesEl = document.getElementById("notes");
    if (notesEl) notesEl.value = "";

    const durationEl = document.getElementById("duration-min");
    if (durationEl) durationEl.value = "";
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
