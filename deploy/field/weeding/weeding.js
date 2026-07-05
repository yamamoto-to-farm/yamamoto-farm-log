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
import { toNumber, calcPer10a, distributePesticideUsageByField } from "/common/pesticide-calc.js?v=1";
import { getSelectedWorkers } from "/common/ui.js?v=1";
import { saveMultiFieldLog } from "/common/general-log/base.js?v=1";
import { showSaveModal, closeSaveModal, completeSaveModal } from "/common/save-modal.js?v=1";

let pesticideDict = {};

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
    renderPesticideAmountInputs();
  });

  window.addEventListener("filter:reset", async () => {
    await updateSelectedFieldsUI();
    renderPesticideAmountInputs();
  });

  await updateSelectedFieldsUI();
  updateWorkTypeUI();
  renderPesticideAmountInputs();

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

  if (needsPesticide) {
    renderPesticideAmountInputs();
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
  pesticideDict = {};

  list.forEach(p => {
    const cat = p.category || "その他";
    pesticideDict[p.name] = p;
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
  window.__weeding_totalA = totalA;
  const areaEl = document.getElementById("field-area-total");
  if (areaEl) areaEl.textContent = `合計面積：${totalA.toFixed(1)} a`;

  updatePer10aForAll();
}

async function saveWeedingLog() {
  const date = document.getElementById("date")?.value || "";
  const workType = document.getElementById("work-type")?.value || "";
  const notes = (document.getElementById("notes")?.value || "").trim();
  const fields = filterState.fields || [];
  const workers = getSelectedWorkers("workers_box", "temp_workers");
  const machine = window.__weeding_machine || "machine1";

  if (!date || !workType || fields.length === 0) {
    alert("作業日・作業区分・圃場は必須です");
    return;
  }
  if (!String(workers || "").trim()) {
    alert("作業者は必須です");
    return;
  }

  const pesticides = filterState.pesticides || [];
  if (workType === "除草剤散布" && pesticides.length === 0) {
    alert("除草剤散布を選択した場合は農薬を選択してください");
    return;
  }

  let pesticideUsage = [];
  let distributed = undefined;

  if (workType === "除草剤散布") {
    pesticideUsage = getSelectedPesticideUsageData();
    if (pesticideUsage.length === 0) {
      alert("除草剤散布では、農薬ごとの希釈倍率と合計散布水量を入力してください");
      return;
    }

    distributed = await distributePesticideUsageByField(fields, pesticideUsage);
  }

  const btn = document.getElementById("save-btn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "保存中…";
  }
  showSaveModal("保存しています…");

  try {
    await saveMultiFieldLog({
      type: "weeding",
      date,
      fields,
      entry: {
        workType,
        pesticides,
        ...(pesticideUsage.length ? { pesticideUsage } : {}),
        ...(distributed ? { distributed } : {}),
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

function renderPesticideAmountInputs() {
  const area = document.getElementById("pesticide-amount-input-area");
  if (!area) return;

  const workType = document.getElementById("work-type")?.value || "";
  if (workType !== "除草剤散布") {
    area.innerHTML = `<p style="color:#777; margin:0;">除草剤散布を選択すると希釈倍率と合計散布水量の入力欄が表示されます</p>`;
    return;
  }

  const selected = filterState.pesticides || [];
  if (!selected.length) {
    area.innerHTML = `<p style="color:#777; margin:0;">農薬を選択すると希釈倍率と合計散布水量の入力欄が表示されます</p>`;
    return;
  }

  area.innerHTML = selected.map(name => {
    const p = pesticideDict[name] || {};
    const unit = p.unit || "L";
    return `
      <div class="card" style="margin-top:8px;">
        <div style="font-weight:700; margin-bottom:8px;">${escapeHtml(name)}</div>
        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
          <span>倍率：</span>
          <input type="text" class="form-input weed-dilution-input" data-name="${escapeAttr(name)}" inputmode="decimal" pattern="[0-9]*(\\.[0-9]+)?" placeholder="例: 1000" style="max-width:140px;">
          <span>倍</span>
          <span>散布液量：</span>
          <input type="text" class="form-input weed-water-total-input" data-name="${escapeAttr(name)}" inputmode="decimal" pattern="[0-9]*(\\.[0-9]+)?" placeholder="例: 120" style="max-width:140px;">
          <span>${escapeHtml(unit)}</span>
        </div>
        <div class="weeding-per10a" data-name="${escapeAttr(name)}" style="margin-top:8px; color:#555;">散布液量：- ${escapeHtml(unit)}/10a</div>
      </div>
    `;
  }).join("");

  bindPesticideAmountInputEvents();
  updatePer10aForAll();
}

function bindPesticideAmountInputEvents() {
  document.querySelectorAll(".weed-water-total-input").forEach(input => {
    input.addEventListener("input", () => {
      updatePer10aForAll();
    });
  });
}

function updatePer10aForAll() {
  const totalA = Number(window.__weeding_totalA || 0);
  document.querySelectorAll(".weeding-per10a").forEach(el => {
    const name = el.dataset.name || "";
    const p = pesticideDict[name] || {};
    const unit = p.unit || "L";

    if (!totalA) {
      el.textContent = `散布液量：- ${unit}/10a`;
      return;
    }

    const input = document.querySelector(`.weed-water-total-input[data-name="${cssEscape(name)}"]`);
    const total = toNumber(input?.value);
    const per10a = calcPer10a(total, totalA).toFixed(1);
    el.textContent = `散布液量：${per10a} ${unit}/10a`;
  });
}

function getSelectedPesticideUsageData() {
  const selected = filterState.pesticides || [];
  const rows = [];

  selected.forEach(name => {
    const p = pesticideDict[name] || {};
    const dilutionInput = document.querySelector(`.weed-dilution-input[data-name="${cssEscape(name)}"]`);
    const sprayInput = document.querySelector(`.weed-water-total-input[data-name="${cssEscape(name)}"]`);

    const dilution_rate = toNumber(dilutionInput?.value);
    const total_water_amount = toNumber(sprayInput?.value);
    if (dilution_rate <= 0 || total_water_amount <= 0) return;

    rows.push({
      pesticide_id: p.id || "",
      name,
      dilution_rate,
      total_water_amount,
      total_spray_amount: total_water_amount,
      unit: p.unit || "L"
    });
  });

  return rows;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === "function") {
    return window.CSS.escape(value);
  }
  return String(value).replace(/\\/g, "\\\\").replace(/\"/g, "\\\"");
}
