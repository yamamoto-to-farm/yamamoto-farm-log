// bedmaking/bedmaking.js

const DEBUG = true;
function debugLog(...args) {
  if (DEBUG) console.log("[bedmaking]", ...args);
}

import { openFieldModal } from "/common/filter/filter-field.js?v=1";
import { openFertilizerModal } from "/common/filter/filter-fertilizer.js?v=1";
import { setFilterData, getFilterData, filterState } from "/common/filter/filter-core.js?v=1";
import { initActiveFilterUI } from "/common/filter/filter-active.js?v=1";
import { getTotalFieldSize } from "/common/field-utils.js?v=1";
import { getSelectedWorkers } from "/common/ui.js?v=1";
import { saveMultiFieldLog } from "/common/general-log/base.js?v=1";
import { showSaveModal, closeSaveModal, completeSaveModal, confirmSaveBeforeSubmit } from "/common/save-modal.js?v=1";
import { setFertilizerDict, renderFertilizerInputs, getFertilizerInputData } from "/fertilizer/fertilizer-multi-input.js?v=1";
import { distributeFertilizers } from "/fertilizer/fertilizer-distribute.js?v=1";

export async function initBedmakingPage() {
  debugLog("initBedmakingPage start");

  await initFieldFilterData();
  await initFertilizerFilterData();

  initActiveFilterUI();

  const btnField = document.getElementById("open-field-modal");
  if (btnField) {
    btnField.onclick = () => {
      openFieldModal({ mode: "filter" });
    };
  }

  const btnFertilizer = document.getElementById("open-fertilizer-modal");
  if (btnFertilizer) {
    btnFertilizer.onclick = () => {
      openFertilizerModal({ mode: "filter" });
    };
  }

  const withFertilizer = document.getElementById("with-fertilizer");
  const fertilizerArea = document.getElementById("fertilizer-area");
  if (withFertilizer && fertilizerArea) {
    withFertilizer.addEventListener("change", () => {
      fertilizerArea.style.display = withFertilizer.checked ? "block" : "none";
    });
  }

  window.addEventListener("filter:apply", async () => {
    await updateSelectedFieldsUI();
    renderFertilizerInputs();
  });

  window.addEventListener("filter:reset", async () => {
    await updateSelectedFieldsUI();
  });

  await updateSelectedFieldsUI();

  const btnSave = document.getElementById("save-btn");
  if (btnSave) {
    btnSave.onclick = saveBedmakingLog;
  }

  debugLog("initBedmakingPage done");
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

async function initFertilizerFilterData() {
  const res = await fetch("/data/fertilizer/fertilizer-index.json?v=" + Date.now());
  const list = await res.json();

  const dict = {};
  list.forEach(f => {
    dict[f.name] = f;
  });
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
}

async function updateSelectedFieldsUI() {
  const fields = filterState.fields || [];

  const el = document.getElementById("selected-fields");
  if (el) el.textContent = fields.length ? fields.join("、") : "未選択";

  const totalA = await getTotalFieldSize(fields);
  const areaEl = document.getElementById("field-area-total");
  if (areaEl) areaEl.textContent = `合計面積：${totalA.toFixed(1)} a`;
}

async function saveBedmakingLog() {
  const date = document.getElementById("date")?.value || "";
  const workType = document.getElementById("work-type")?.value || "";
  const ridgeWidthCm = Number(document.getElementById("ridge-width-cm")?.value || 0);
  const ridgeHeightCm = Number(document.getElementById("ridge-height-cm")?.value || 0);
  const notes = (document.getElementById("notes")?.value || "").trim();
  const fields = filterState.fields || [];
  const workers = getSelectedWorkers("workers_box", "temp_workers");
  const machine = window.__bedmaking_machine || "machine1";
  const withFertilizer = Boolean(document.getElementById("with-fertilizer")?.checked);

  if (!date || !workType || fields.length === 0) {
    alert("作業日・作業区分・圃場は必須です");
    return;
  }
  if (!String(workers || "").trim()) {
    alert("作業者は必須です");
    return;
  }

  let fertilizers = [];
  let distributed = [];

  if (withFertilizer) {
    fertilizers = (getFertilizerInputData() || []).filter(f => Number(f.total_kg) > 0);

    if (fertilizers.length === 0) {
      alert("同時施肥を行う場合は、肥料と使用量を入力してください");
      return;
    }

    distributed = await distributeFertilizers(fields, fertilizers);
  }

  const fieldsLabel = fields.length <= 4
    ? fields.join("、")
    : `${fields.slice(0, 4).join("、")} ほか${fields.length - 4}件`;
  const confirmed = await confirmSaveBeforeSubmit({
    lines: [
      `日付: ${date}`,
      `作業区分: ${workType}`,
      `圃場: ${fieldsLabel}`,
      `作業者: ${workers}`,
      `同時施肥: ${withFertilizer ? "あり" : "なし"}`
    ]
  });
  if (!confirmed) return;

  const btn = document.getElementById("save-btn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "保存中…";
  }
  showSaveModal("保存しています…");

  try {
    await saveMultiFieldLog({
      type: "bedmaking",
      date,
      fields,
      entry: {
        workType,
        ridgeWidthCm: Number.isFinite(ridgeWidthCm) ? ridgeWidthCm : 0,
        ridgeHeightCm: Number.isFinite(ridgeHeightCm) ? ridgeHeightCm : 0,
        machine,
        workers,
        notes
      }
    });

    if (withFertilizer) {
      await saveMultiFieldLog({
        type: "fertilizer",
        date,
        fields,
        entry: {
          distributed,
          machine,
          workers,
          sourceWork: "bedmaking",
          sourceWorkType: workType,
          sourceRidgeWidthCm: Number.isFinite(ridgeWidthCm) ? ridgeWidthCm : 0,
          sourceRidgeHeightCm: Number.isFinite(ridgeHeightCm) ? ridgeHeightCm : 0,
          notes: notes ? `[畝立て同時施肥] ${notes}` : "[畝立て同時施肥]",
          fertilizerItems: fertilizers
        }
      });
    }

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
