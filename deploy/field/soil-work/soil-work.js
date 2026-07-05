// field/soil-work/soil-work.js

const DEBUG = true;
function debugLog(...args) {
  if (DEBUG) console.log("[soil-work]", ...args);
}

import { openFieldModal } from "/common/filter/filter-field.js?v=1";
import { openFertilizerModal } from "/common/filter/filter-fertilizer.js?v=1";
import { setFilterData, getFilterData, filterState } from "/common/filter/filter-core.js?v=1";
import { initActiveFilterUI } from "/common/filter/filter-active.js?v=1";
import { getTotalFieldSize } from "/common/field-utils.js?v=1";
import { getSelectedWorkers } from "/common/ui.js?v=1";
import { saveMultiFieldLog } from "/common/general-log/base.js?v=1";
import { showSaveModal, closeSaveModal } from "/common/save-modal.js?v=1";
import { setFertilizerDict, renderFertilizerInputs, getFertilizerInputData, updatePer10aAll } from "/fertilizer/fertilizer-multi-input.js?v=1";
import { distributeFertilizers } from "/fertilizer/fertilizer-distribute.js?v=1";

const MODE_CONFIG = {
  intertill: {
    title: "中耕ログ",
    saveType: "intertill",
    selectorLabel: "アタッチメント",
    selectorPlaceholder: "アタッチメントを選択",
    attachmentOptions: ["ロータリカルチCR33B", "爪カルチ(リッチャー)"],
    singleAttachment: false,
    ridgeWidthMode: "hidden",
    ridgeHeightMode: "hidden",
    ridgeCountMode: "hidden",
    defaultRidgeWidthCm: null
  },
  bedmaking: {
    title: "畝立てログ",
    saveType: "bedmaking",
    selectorLabel: "アタッチメント",
    selectorPlaceholder: "",
    attachmentOptions: ["スーパー台形成形機"],
    singleAttachment: true,
    ridgeWidthMode: "fixed",
    ridgeHeightMode: "optional",
    ridgeCountMode: "optional",
    defaultRidgeWidthCm: 60
  }
};

function getMode() {
  const params = new URLSearchParams(location.search);
  const mode = params.get("mode");
  return MODE_CONFIG[mode] ? mode : "";
}

function openMode(mode) {
  const params = new URLSearchParams(location.search);
  params.set("mode", mode);
  location.href = `${location.pathname}?${params.toString()}`;
}

function setupModeSelector() {
  document.getElementById("mode-area").style.display = "block";

  const intertillBtn = document.getElementById("go-intertill");
  if (intertillBtn) intertillBtn.onclick = () => openMode("intertill");

  const bedmakingBtn = document.getElementById("go-bedmaking");
  if (bedmakingBtn) bedmakingBtn.onclick = () => openMode("bedmaking");
}

function applyModeUi(config) {
  const title = document.getElementById("page-title");
  if (title) title.textContent = config.title;

  const taskLabel = document.getElementById("task-label");
  if (taskLabel) taskLabel.textContent = config.selectorLabel || "作業内容";

  const taskSelect = document.getElementById("task-select");
  if (taskSelect) {
    taskSelect.innerHTML = "";

    if (!config.singleAttachment) {
      const first = document.createElement("option");
      first.value = "";
      first.textContent = config.selectorPlaceholder || "選択してください";
      taskSelect.appendChild(first);
    }

    config.attachmentOptions.forEach(v => {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      taskSelect.appendChild(opt);
    });

    if (config.singleAttachment && config.attachmentOptions.length === 1) {
      taskSelect.value = config.attachmentOptions[0];
      taskSelect.disabled = true;
    } else {
      taskSelect.disabled = false;
    }
  }

  const ridgeWidthField = document.getElementById("ridge-width-field");
  const ridgeWidthInput = document.getElementById("ridge-width-cm");
  if (ridgeWidthField && ridgeWidthInput) {
    if (config.ridgeWidthMode === "hidden") {
      ridgeWidthField.style.display = "none";
      ridgeWidthInput.value = "";
      ridgeWidthInput.disabled = true;
    } else if (config.ridgeWidthMode === "fixed") {
      ridgeWidthField.style.display = "block";
      ridgeWidthInput.value = String(config.defaultRidgeWidthCm ?? 60);
      ridgeWidthInput.disabled = true;
    } else {
      ridgeWidthField.style.display = "block";
      ridgeWidthInput.disabled = false;
    }
  }

  const ridgeHeightField = document.getElementById("ridge-height-field");
  const ridgeHeightInput = document.getElementById("ridge-height-cm");
  if (ridgeHeightField && ridgeHeightInput) {
    if (config.ridgeHeightMode === "hidden") {
      ridgeHeightField.style.display = "none";
      ridgeHeightInput.value = "";
      ridgeHeightInput.disabled = true;
    } else {
      ridgeHeightField.style.display = "block";
      ridgeHeightInput.disabled = false;
    }
  }

  const ridgeCountField = document.getElementById("ridge-count-field");
  const ridgeCountInput = document.getElementById("ridge-count");
  if (ridgeCountField && ridgeCountInput) {
    if (config.ridgeCountMode === "hidden") {
      ridgeCountField.style.display = "none";
      ridgeCountInput.value = "";
      ridgeCountInput.disabled = true;
    } else {
      ridgeCountField.style.display = "block";
      ridgeCountInput.disabled = false;
    }
  }
}

export async function initSoilWorkPage() {
  const mode = getMode();
  if (!mode) {
    setupModeSelector();
    return;
  }

  const config = MODE_CONFIG[mode];

  document.getElementById("form-area").style.display = "block";
  applyModeUi(config);

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
      if (withFertilizer.checked) {
        updateFertilizerPer10aFromCurrentFields();
      }
    });
  }

  window.addEventListener("filter:apply", async () => {
    await updateSelectedFieldsUI();
    renderFertilizerInputs();
    updateFertilizerPer10aFromCurrentFields();
  });

  window.addEventListener("filter:reset", async () => {
    await updateSelectedFieldsUI();
    updateFertilizerPer10aFromCurrentFields();
  });

  await updateSelectedFieldsUI();

  const btnSave = document.getElementById("save-btn");
  if (btnSave) {
    btnSave.onclick = () => saveSoilWorkLog(config, mode);
  }

  debugLog("initSoilWorkPage done", { mode });
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

  window.__fertilizer_totalA = totalA;
}

function updateFertilizerPer10aFromCurrentFields() {
  const totalA = Number(window.__fertilizer_totalA || 0);
  updatePer10aAll(totalA);
}

async function saveSoilWorkLog(config, mode) {
  const date = document.getElementById("date")?.value || "";
  const attachment = document.getElementById("task-select")?.value || "";
  const ridgeWidthRaw = document.getElementById("ridge-width-cm")?.value || "";
  const ridgeHeightRaw = document.getElementById("ridge-height-cm")?.value || "";
  const ridgeCountRaw = document.getElementById("ridge-count")?.value || "";
    const ridgeWidthCm = config.ridgeWidthMode === "fixed"
      ? Number(config.defaultRidgeWidthCm ?? 60)
      : (config.ridgeWidthMode === "hidden" ? null : (ridgeWidthRaw === "" ? null : Number(ridgeWidthRaw)));

    const ridgeHeightCm = config.ridgeHeightMode === "hidden"
      ? null
      : (ridgeHeightRaw === "" ? null : Number(ridgeHeightRaw));

    const ridgeCount = config.ridgeCountMode === "hidden"
      ? null
      : (ridgeCountRaw === "" ? null : Number(ridgeCountRaw));

  const notes = (document.getElementById("notes")?.value || "").trim();
  const fields = filterState.fields || [];
  const workers = getSelectedWorkers("workers_box", "temp_workers");
  const machine = window.__soil_work_machine || "machine1";
  const withFertilizer = Boolean(document.getElementById("with-fertilizer")?.checked);

  if (!date || !attachment || fields.length === 0) {
    alert("作業日・アタッチメント・圃場は必須です");
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

  const btn = document.getElementById("save-btn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "保存中…";
  }
  showSaveModal("保存しています…");

  try {
    await saveMultiFieldLog({
      type: config.saveType,
      date,
      fields,
      entry: {
        workType: attachment,
        attachment,
        ridgeWidthCm: Number.isFinite(ridgeWidthCm) ? ridgeWidthCm : null,
        ridgeHeightCm: Number.isFinite(ridgeHeightCm) ? ridgeHeightCm : null,
        ridgeCount: Number.isFinite(ridgeCount) ? ridgeCount : null,
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
          sourceWork: mode,
          sourceWorkType: attachment,
          attachment,
          sourceRidgeWidthCm: Number.isFinite(ridgeWidthCm) ? ridgeWidthCm : null,
          sourceRidgeHeightCm: Number.isFinite(ridgeHeightCm) ? ridgeHeightCm : null,
          sourceRidgeCount: Number.isFinite(ridgeCount) ? ridgeCount : null,
          notes: notes ? `[${config.title}同時施肥] ${notes}` : `[${config.title}同時施肥]`,
          fertilizerItems: fertilizers
        }
      });
    }

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
