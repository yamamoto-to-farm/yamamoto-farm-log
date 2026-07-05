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
import { showSaveModal, closeSaveModal, completeSaveModal } from "/common/save-modal.js?v=1";

const DEFAULT_TILLAGE_ATTACHMENTS = ["耕うん（ロータリー）", "サブソイラー"];

export async function initTillagePage() {
  debugLog("initTillagePage start");

  await initFieldFilterData();
  await applyTillageAttachmentOptions();

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

function normalizeAttachmentList(value, fallback) {
  if (!Array.isArray(value)) return [...fallback];
  const list = value
    .map(v => String(v || "").trim())
    .filter(Boolean);
  return list.length ? [...new Set(list)] : [...fallback];
}

async function loadAttachmentIndex() {
  try {
    const res = await fetch(`/data/attachment-index.json?v=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json();
    return json && typeof json === "object" ? json : null;
  } catch {
    return null;
  }
}

async function applyTillageAttachmentOptions() {
  const select = document.getElementById("work-type");
  if (!select) return;

  const index = await loadAttachmentIndex();
  const options = normalizeAttachmentList(index?.tillage, DEFAULT_TILLAGE_ATTACHMENTS);

  select.innerHTML = "";
  const first = document.createElement("option");
  first.value = "";
  first.textContent = "アタッチメントを選択";
  select.appendChild(first);

  options.forEach(v => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    select.appendChild(opt);
  });
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
  const machine = window.__tillage_machine || "machine1";

  if (!date || !type || fields.length === 0) {
    alert("作業日・作業内容・圃場は必須です");
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
    completeSaveModal("保存が完了しました");

    const notesEl = document.getElementById("notes");
    if (notesEl) notesEl.value = "";
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
