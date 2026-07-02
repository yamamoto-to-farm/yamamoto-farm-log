// field/weeding/weeding.js

const DEBUG = true;
function debugLog(...args) {
  if (DEBUG) console.log("[weeding]", ...args);
}

import { openFieldModal } from "/common/filter/filter-field.js?v=1";
import { openpesticideModal } from "/common/filter/filter-pesticide.js?v=1";
import { setFilterData, getFilterData, filterState } from "/common/filter/filter-core.js?v=1";
import { initActiveFilterUI } from "/common/filter/filter-active.js?v=1";
import { getTotalFieldSize } from "/common/field-utils.js?v=1";
import { getSelectedWorkers } from "/common/ui.js?v=1";
import { saveMultiFieldLog } from "/common/general-log/base.js?v=1";

export async function initWeedingPage() {
  debugLog("initWeedingPage start");

  await initFieldFilterData();
  await initPesticideFilterData();

  initActiveFilterUI();

  const btnField = document.getElementById("open-field-modal");
  if (btnField) {
    btnField.onclick = () => openFieldModal({ mode: "filter" });
  }

  const btnPesticide = document.getElementById("open-pesticide-modal");
  if (btnPesticide) {
    btnPesticide.onclick = () => openpesticideModal({ mode: "filter" });
  }

  const workType = document.getElementById("work-type");
  if (workType) {
    workType.addEventListener("change", () => {
      updateWorkTypeUI();
    });
  }

  window.addEventListener("filter:apply", async () => {
    await updateSelectedFieldsUI();
  });

  window.addEventListener("filter:reset", async () => {
    await updateSelectedFieldsUI();
  });

  await updateSelectedFieldsUI();
  updateWorkTypeUI();

  const btnSave = document.getElementById("save-btn");
  if (btnSave) {
    btnSave.onclick = saveWeedingLog;
  }

  debugLog("initWeedingPage done");
}

function updateWorkTypeUI() {
  const type = document.getElementById("work-type")?.value || "";
  const pesticideSection = document.getElementById("pesticide-section");

  const needsPesticide = type === "除草剤散布";

  if (pesticideSection) {
    pesticideSection.style.display = needsPesticide ? "block" : "none";
  }

  // 草刈りに切り替えた時は農薬選択をクリア
  if (!needsPesticide && Array.isArray(filterState.pesticides) && filterState.pesticides.length) {
    filterState.pesticides = [];
    window.dispatchEvent(new CustomEvent("filter:apply"));
  }
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

async function initPesticideFilterData() {
  const res = await fetch("/data/pesticide/pesticide-index.json?v=" + Date.now());
  const list = await res.json();

  const parents = [];
  const children = {};

  list.forEach(p => {
    const cat = p.category || "その他";
    if (!children[cat]) {
      children[cat] = [];
      parents.push(cat);
    }
    children[cat].push(p.name);
  });

  const current = getFilterData();
  setFilterData({
    ...current,
    pesticides: { parents, children }
  });
}

async function updateSelectedFieldsUI() {
  const fields = filterState.fields || [];

  const totalA = await getTotalFieldSize(fields);
  const areaEl = document.getElementById("field-area-total");
  if (areaEl) areaEl.textContent = `合計面積：${totalA.toFixed(1)} a`;
}

async function saveWeedingLog() {
  const date = document.getElementById("date")?.value || "";
  const workType = document.getElementById("work-type")?.value || "";
  const notes = (document.getElementById("notes")?.value || "").trim();
  const fields = filterState.fields || [];
  const workers = getSelectedWorkers("workers_box", "temp_workers");
  const machine = window.__weeding_machine || "";

  if (!date || !workType || fields.length === 0) {
    alert("作業日・作業区分・圃場は必須です");
    return;
  }

  const pesticides = filterState.pesticides || [];
  if (workType === "除草剤散布" && pesticides.length === 0) {
    alert("除草剤散布を選択した場合は農薬を選択してください");
    return;
  }

  const btn = document.getElementById("save-btn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "保存中…";
  }

  try {
    await saveMultiFieldLog({
      type: "weeding",
      date,
      fields,
      entry: {
        workType,
        pesticides,
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
