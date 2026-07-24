const DEBUG = true;

function debugLog(...args) {
  if (DEBUG) console.log("[nursery-pesticide-input]", ...args);
}

import { filterState } from "/common/filter/filter-core.js?v=1";
import { toNumber } from "/common/pesticide-calc.js?v=1";
import { openPesticideInfoModal } from "/common/materials/pesticide-view-modal.js?v=1";

export let pesticideDict = {};

export function setpesticideDict(dict) {
  pesticideDict = dict;
  debugLog("setpesticideDict:", dict);
}

export function renderNurseryPesticideInputs() {
  const area = document.getElementById("pesticide-input-area");
  if (!area) return;

  const selected = filterState.pesticides || [];
  if (selected.length === 0) {
    area.innerHTML = `<p class="no-pesticide">農薬が選択されていません</p>`;
    return;
  }

  area.innerHTML = selected.map(name => {
    const f = pesticideDict[name] || {};
    const chemicalUnit = f.unit || "ml";

    return `
      <div class="pesticide-row" data-name="${name}">
        <div class="pesticide-title" style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <span>${name}</span>
          <button type="button" class="secondary-btn open-pesticide-info-btn" data-name="${name}" style="padding:2px 8px; font-size:0.82em;">詳細</button>
        </div>

        <div class="pesticide-line" style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <span>倍率：</span>
          <input type="text" inputmode="decimal" pattern="[0-9]*(\\.[0-9]+)?" class="dilution-input" data-name="${name}" placeholder="例: 1000" value="" style="max-width:140px;">
          <span>倍</span>
          <span>散布液量：</span>
          <input type="text" inputmode="decimal" pattern="[0-9]*(\\.[0-9]+)?" class="water-total-input" data-name="${name}" placeholder="例: 120" value="" style="max-width:140px;">
          <span>L</span>
        </div>

        <div class="chemical-per10a" style="margin-top:2px; color:#555;">
          育苗用のため、対象面積ではなく対象選択に紐づく記録として保存します
        </div>
      </div>
    `;
  }).join("");

  initInputEvents();
}

function initInputEvents() {
  document.querySelectorAll(".open-pesticide-info-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const name = btn.dataset.name;
      const detail = pesticideDict[name] || {};
      openPesticideInfoModal(detail);
    });
  });
}

export function getNurseryPesticideInputData() {
  const selected = filterState.pesticides || [];
  const result = [];

  selected.forEach(name => {
    const dilutionInput = document.querySelector(`.dilution-input[data-name="${name}"]`);
    const sprayTotalInput = document.querySelector(`.water-total-input[data-name="${name}"]`);

    if (!dilutionInput || !sprayTotalInput) return;

    const dilution_rate = toNumber(dilutionInput.value);
    const total_water_amount = toNumber(sprayTotalInput.value);
    const f = pesticideDict[name];
    if (!f || dilution_rate <= 0 || total_water_amount <= 0) return;

    result.push({
      pesticide_id: f.id,
      name,
      dilution_rate,
      total_water_amount,
      total_spray_amount: total_water_amount,
      unit: "L",
      pesticide_unit: f.unit || "ml",
      category: String(f.category || "").trim(),
      materialType: String(f.materialType || "pesticide"),
      sourceMaster: String(f.sourceMaster || "pesticide-index")
    });
  });

  return result;
}