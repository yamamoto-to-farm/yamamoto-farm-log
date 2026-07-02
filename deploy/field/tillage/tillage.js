// field/tillage/tillage.js

const DEBUG = true;
function debugLog(...args) {
  if (DEBUG) console.log("[tillage]", ...args);
}

import { openFieldModal } from "/common/filter/filter-field.js?v=1";
import { setFilterData, getFilterData, filterState } from "/common/filter/filter-core.js?v=1";
import { initActiveFilterUI } from "/common/filter/filter-active.js?v=1";
import { getTotalFieldSize } from "/common/field-utils.js?v=1";
import { getSelectedWorkers } from "/common/ui.js?v=1";
import { saveMultiFieldLog } from "/common/general-log/base.js?v=1";

export async function initTillagePage() {
  debugLog("initTillagePage start");

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
    btnSave.onclick = saveTillageLog;
  }

  debugLog("initTillagePage done");
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

async function saveTillageLog() {
  const date = document.getElementById("date")?.value || "";
  const type = document.getElementById("work-type")?.value || "";
  const depthCm = Number(document.getElementById("depth-cm")?.value || 0);
  const speedKmh = Number(document.getElementById("speed-kmh")?.value || 0);
  const notes = (document.getElementById("notes")?.value || "").trim();
  const fields = filterState.fields || [];
  const workers = getSelectedWorkers("workers_box", "temp_workers");
  const machine = window.__tillage_machine || "";

  if (!date || !type || fields.length === 0) {
    alert("作業日・作業区分・圃場は必須です");
    return;
  }

  const btn = document.getElementById("save-btn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "保存中…";
  }

  try {
    await saveMultiFieldLog({
      type: "tillage",
      date,
      fields,
      entry: {
        workType: type,
        depthCm: Number.isFinite(depthCm) ? depthCm : 0,
        speedKmh: Number.isFinite(speedKmh) ? speedKmh : 0,
        machine,
        workers,
        notes
      }
    });

    alert("保存しました！");
    const notesEl = document.getElementById("notes");
    if (notesEl) notesEl.value = "";
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
