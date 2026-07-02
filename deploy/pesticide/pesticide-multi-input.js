// /common/pesticide/pesticide-multi-input.js

// ===============================
// デバッグフラグ
// ===============================
const DEBUG = true;   // ← false にすればログが一切出ない

function debugLog(...args) {
    if (DEBUG) console.log("[multi-input-debug]", ...args);
}

import { filterState } from "/common/filter/filter-core.js?v=1";

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
                const unit = f.unit || "L";

        debugLog(`render row for ${name}`, f);

        return `
  <div class="pesticide-row" data-name="${name}">
    <div class="pesticide-title">${name}</div>

    <div class="pesticide-line">
            倍率：
            <input type="text"
                         inputmode="decimal"
                         pattern="[0-9]*(\\.[0-9]+)?"
                         class="dilution-input"
             data-name="${name}"
                         placeholder="例: 1000"
                         value=""> 倍
        </div>

        <div class="pesticide-line" style="margin-top:6px;">
            合計散布量：
            <input type="text"
                         inputmode="decimal"
                         pattern="[0-9]*(\\.[0-9]+)?"
                         class="spray-total-input"
                         data-name="${name}"
                         placeholder="例: 120"
                         value=""> ${unit}
        </div>

        <div class="per10a" id="per10a-${f.id}" style="margin-top:4px; color:#555;">
            - ${unit}/10a
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

    document.querySelectorAll(".spray-total-input").forEach(input => {
        input.addEventListener("input", () => {
            const name = input.dataset.name;
            const total = toNumber(input.value);
            debugLog(`spray total changed for ${name}: total=${total}`);

            // /10a 更新（pesticide.js 側で totalA をセットして呼ぶ）
            if (window.__pesticide_totalA) {
                updatePer10aAll(window.__pesticide_totalA);
            }
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
            const row = el.closest(".pesticide-row");
            const pesticideName = row?.dataset?.name || "";
            const f = pesticideDict[pesticideName] || {};
            const unit = f.unit || "L";
            el.textContent = `- ${unit}/10a`;
        });
        return;
    }

    const selected = filterState.pesticides || [];

    selected.forEach(name => {
        const f = pesticideDict[name];
        if (!f) return;

        const sprayInput = document.querySelector(
            `.spray-total-input[data-name="${name}"]`
        );
        if (!sprayInput) return;

        const totalSpray = toNumber(sprayInput.value);
        const per10a = (totalSpray / totalA * 10).toFixed(1);
        const unit = f.unit || "L";

        const el = document.getElementById(`per10a-${f.id}`);
        if (el) el.textContent = `${per10a} ${unit}/10a`;
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
            `.spray-total-input[data-name="${name}"]`
        );

        if (!dilutionInput || !sprayTotalInput) {
            debugLog(`inputs not found for ${name}`);
            return;
        }

        const dilution_rate = toNumber(dilutionInput.value);
        const total_spray_amount = toNumber(sprayTotalInput.value);

        const f = pesticideDict[name];
        const unit = f.unit || "L";

        if (dilution_rate <= 0 || total_spray_amount <= 0) {
            debugLog(`skip ${name} because values are empty or invalid`, {
                dilution_rate,
                total_spray_amount
            });
            return;
        }

        const row = {
            pesticide_id: f.id,
            name,
            dilution_rate,
            total_spray_amount,
            unit
        };

        debugLog("row:", row);

        result.push(row);
    });

    debugLog("getpesticideInputData result:", result);
    return result;
}

function toNumber(value) {
    const num = Number(String(value ?? "").trim());
    return Number.isFinite(num) ? num : 0;
}
