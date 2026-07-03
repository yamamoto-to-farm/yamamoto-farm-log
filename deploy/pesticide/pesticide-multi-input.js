// /common/pesticide/pesticide-multi-input.js

// ===============================
// デバッグフラグ
// ===============================
const DEBUG = true;   // ← false にすればログが一切出ない

function debugLog(...args) {
    if (DEBUG) console.log("[multi-input-debug]", ...args);
}

import { filterState } from "/common/filter/filter-core.js?v=1";
import { toNumber, calcPer10a } from "/common/pesticide-calc.js?v=1";
import { openPesticideInfoModal } from "/common/materials/pesticide-view-modal.js?v=1";

/* ============================================================
    農薬辞書（name → full object）
    pesticide-index.json を読み込んだ pesticide.js からセットされる
============================================================ */
export let pesticideDict = {};

export function setpesticideDict(dict) {
    pesticideDict = dict;
    debugLog("setpesticideDict:", dict);
}

/* ============================================================
    複数農薬入力 UI を描画
============================================================ */
export function renderpesticideInputs() {
    debugLog("renderpesticideInputs start");

    const area = document.getElementById("pesticide-input-area");
    if (!area) {
        debugLog("pesticide-input-area not found");
        return;
    }

    const selected = filterState.pesticides || [];
    debugLog("selected pesticides:", selected);

    if (selected.length === 0) {
        area.innerHTML = `<p class="no-pesticide">農薬が選択されていません</p>`;
        debugLog("no pesticides selected");
        return;
    }

    // UI を生成
    area.innerHTML = selected.map(name => {
        const f = pesticideDict[name] || {};
        const chemicalUnit = f.unit || "ml";

        debugLog(`render row for ${name}`, f);

        return `
  <div class="pesticide-row" data-name="${name}">
        <div class="pesticide-title" style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <span>${name}</span>
            <button type="button" class="secondary-btn open-pesticide-info-btn" data-name="${name}" style="padding:2px 8px; font-size:0.82em;">詳細</button>
        </div>

    <div class="pesticide-line" style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <span>倍率：</span>
            <input type="text"
                         inputmode="decimal"
                         pattern="[0-9]*(\\.[0-9]+)?"
                         class="dilution-input"
             data-name="${name}"
                         placeholder="例: 1000"
                         value="" style="max-width:140px;"> <span>倍</span>
            <span>散布液量：</span>
            <input type="text"
                         inputmode="decimal"
                         pattern="[0-9]*(\\.[0-9]+)?"
                         class="water-total-input"
                         data-name="${name}"
                         placeholder="例: 120"
                                                 value="" style="max-width:140px;"> <span>L</span>
        </div>

        <div class="per10a" id="per10a-${f.id}" style="margin-top:4px; color:#555;">
                        散布液量：- L/10a
                </div>
                <div class="chemical-per10a" id="chemical-per10a-${f.id}" style="margin-top:2px; color:#555;">
                        薬量（倍率換算）：- ${chemicalUnit}/10a
    </div>
  </div>
`;
    }).join("");

    initInputEvents();

    debugLog("renderpesticideInputs done");
}

/* ============================================================
   入力イベント（合計散布量入力時に /10a を再計算）
============================================================ */
function initInputEvents() {
    debugLog("initInputEvents start");

    document.querySelectorAll(".water-total-input").forEach(input => {
        input.addEventListener("input", () => {
            const name = input.dataset.name;
            const total = toNumber(input.value);
            debugLog(`water total changed for ${name}: total=${total}`);

            // /10a 更新（pesticide.js 側で totalA をセットして呼ぶ）
            if (window.__pesticide_totalA) {
                updatePer10aAll(window.__pesticide_totalA);
            }
        });
    });

    document.querySelectorAll(".open-pesticide-info-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const name = btn.dataset.name;
            const detail = pesticideDict[name] || {};
            openPesticideInfoModal(detail);
        });
    });

    debugLog("initInputEvents done");
}

/* ============================================================
   /10a の使用量を更新（pesticide.js から呼ばれる）
============================================================ */
export function updatePer10aAll(totalA) {
    debugLog("updatePer10aAll:", totalA);

    // pesticide.js から参照できるように保存
    window.__pesticide_totalA = totalA;

    if (!totalA || totalA === 0) {
        document.querySelectorAll(".per10a").forEach(el => {
            el.textContent = "散布液量：- L/10a";
        });

        document.querySelectorAll(".chemical-per10a").forEach(el => {
            const row = el.closest(".pesticide-row");
            const pesticideName = row?.dataset?.name || "";
            const f = pesticideDict[pesticideName] || {};
            const chemicalUnit = f.unit || "ml";
            el.textContent = `薬量（倍率換算）：- ${chemicalUnit}/10a`;
        });
        return;
    }

    const selected = filterState.pesticides || [];

    selected.forEach(name => {
        const f = pesticideDict[name];
        if (!f) return;

        const sprayInput = document.querySelector(
            `.water-total-input[data-name="${name}"]`
        );
        const dilutionInput = document.querySelector(
            `.dilution-input[data-name="${name}"]`
        );
        if (!sprayInput) return;

        const totalWater = toNumber(sprayInput.value);
        const per10a = calcPer10a(totalWater, totalA).toFixed(1);
        const dilutionRate = toNumber(dilutionInput?.value);
        const chemicalUnit = f.unit || "ml";

        const el = document.getElementById(`per10a-${f.id}`);
        if (el) el.textContent = `散布液量：${per10a} L/10a`;

        const chemicalEl = document.getElementById(`chemical-per10a-${f.id}`);
        if (chemicalEl) {
            if (dilutionRate > 0) {
                const per10aL = calcPer10a(totalWater, totalA);
                const chemicalL = per10aL / dilutionRate;
                const chemicalAmount = convertLiterToUnit(chemicalL, chemicalUnit);
                const display = Number.isFinite(chemicalAmount)
                  ? formatAmount(chemicalAmount)
                  : "-";
                chemicalEl.textContent = `薬量（倍率換算）：${display} ${chemicalUnit}/10a`;
            } else {
                chemicalEl.textContent = `薬量（倍率換算）：- ${chemicalUnit}/10a`;
            }
        }
    });
}

/* ============================================================
   保存用データを取得
============================================================ */
export function getpesticideInputData() {
    debugLog("getpesticideInputData start");

    const selected = filterState.pesticides || [];
    const result = [];

    selected.forEach(name => {
        const dilutionInput = document.querySelector(
            `.dilution-input[data-name="${name}"]`
        );
        const sprayTotalInput = document.querySelector(
            `.water-total-input[data-name="${name}"]`
        );

        if (!dilutionInput || !sprayTotalInput) {
            debugLog(`inputs not found for ${name}`);
            return;
        }

        const dilution_rate = toNumber(dilutionInput.value);
        const total_water_amount = toNumber(sprayTotalInput.value);

        const f = pesticideDict[name];
        const chemicalUnit = f.unit || "ml";

        if (dilution_rate <= 0 || total_water_amount <= 0) {
            debugLog(`skip ${name} because values are empty or invalid`, {
                dilution_rate,
                total_water_amount
            });
            return;
        }

        const row = {
            pesticide_id: f.id,
            name,
            dilution_rate,
            total_water_amount,
            total_spray_amount: total_water_amount,
            unit: "L",
            pesticide_unit: chemicalUnit
        };

        debugLog("row:", row);

        result.push(row);
    });

    debugLog("getpesticideInputData result:", result);
    return result;
}

function convertLiterToUnit(amountL, unit) {
    const u = String(unit || "").toLowerCase();
    if (u === "ml" || u === "cc") return amountL * 1000;
    return amountL;
}

function formatAmount(value) {
    return Number(value || 0).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}
