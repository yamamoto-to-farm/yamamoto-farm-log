// /common/fertilizer/fertilizer-multi-input.js

// ===============================
// デバッグフラグ
// ===============================
const DEBUG = true;   // ← false にすればログが一切出ない

function debugLog(...args) {
    if (DEBUG) console.log("[multi-input-debug]", ...args);
}

import { filterState } from "/common/filter/filter-core.js?v=1";
import { openFertilizerInfoModal } from "/common/materials/fertilizer-view-modal.js?v=1";

/* ============================================================
   肥料辞書（name → full object）
   fertilizer-index.json を読み込んだ fertilizer.js からセットされる
============================================================ */
export let fertilizerDict = {};

export function setFertilizerDict(dict) {
    fertilizerDict = dict;
    debugLog("setFertilizerDict:", dict);
}

/* ============================================================
   複数肥料入力 UI を描画
============================================================ */
export function renderFertilizerInputs() {
    debugLog("renderFertilizerInputs start");

    const area = document.getElementById("fertilizer-input-area");
    if (!area) {
        debugLog("fertilizer-input-area not found");
        return;
    }

    const selected = filterState.fertilizers || [];
    debugLog("selected fertilizers:", selected);

    if (selected.length === 0) {
        area.innerHTML = `<p class="no-fertilizer">肥料が選択されていません</p>`;
        debugLog("no fertilizers selected");
        return;
    }

    // UI を生成
    area.innerHTML = selected.map(name => {
        const f = fertilizerDict[name] || {};
        const capacity = f.capacity || 0;

        debugLog(`render row for ${name}`, f);

        return `
  <div class="fertilizer-row" data-name="${name}">
        <div class="fertilizer-title" style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <span>${name}</span>
            <button type="button" class="secondary-btn open-fertilizer-info-btn" data-name="${name}" style="padding:2px 8px; font-size:0.82em;">詳細</button>
        </div>

    <div class="fertilizer-line">
      <input type="text"
             inputmode="numeric"
             pattern="[0-9]*"
             class="bags-input"
             data-name="${name}"
             value="0"> 袋

      × ${capacity}kg

      = <span class="total-display" data-name="${name}">0</span> kg
    </div>

    <!-- ★ /10a 表示欄 -->
    <div class="per10a" id="per10a-${f.id}" style="margin-top:4px; color:#555;">
      - kg/10a
    </div>
  </div>
`;
    }).join("");

    initInputEvents();

    debugLog("renderFertilizerInputs done");
}

/* ============================================================
   入力イベント（袋数 → 合計kg 自動計算）
============================================================ */
function initInputEvents() {
    debugLog("initInputEvents start");

    document.querySelectorAll(".bags-input").forEach(input => {
        input.addEventListener("input", () => {
            const name = input.dataset.name;
            const bags = Number(input.value);

            const f = fertilizerDict[name];
            const capacity = f.capacity || 0;

            const total = bags * capacity;

            debugLog(`calc total for ${name}: bags=${bags}, capacity=${capacity}, total=${total}`);

            // ★ span 表示に変更
            const totalDisplay = document.querySelector(
                `.total-display[data-name="${name}"]`
            );
            if (totalDisplay) totalDisplay.textContent = total;

            // ★ /10a 更新（fertilizer.js 側で totalA をセットして呼ぶ）
            if (window.__fertilizer_totalA) {
                updatePer10aAll(window.__fertilizer_totalA);
            }
        });
    });

    document.querySelectorAll(".open-fertilizer-info-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const name = btn.dataset.name;
            const detail = fertilizerDict[name] || {};
            openFertilizerInfoModal(detail);
        });
    });

    debugLog("initInputEvents done");
}

/* ============================================================
   /10a の使用量を更新（fertilizer.js から呼ばれる）
============================================================ */
export function updatePer10aAll(totalA) {
    debugLog("updatePer10aAll:", totalA);

    // fertilizer.js から参照できるように保存
    window.__fertilizer_totalA = totalA;

    if (!totalA || totalA === 0) {
        document.querySelectorAll(".per10a").forEach(el => el.textContent = "- kg/10a");
        return;
    }

    const selected = filterState.fertilizers || [];

    selected.forEach(name => {
        const f = fertilizerDict[name];
        if (!f) return;

        const totalDisplay = document.querySelector(
            `.total-display[data-name="${name}"]`
        );
        if (!totalDisplay) return;

        const totalKg = Number(totalDisplay.textContent);

        const per10a = (totalKg / totalA * 10).toFixed(1);

        const el = document.getElementById(`per10a-${f.id}`);
        if (el) el.textContent = `${per10a} kg/10a`;
    });
}

/* ============================================================
   保存用データを取得
============================================================ */
export function getFertilizerInputData() {
    debugLog("getFertilizerInputData start");

    const selected = filterState.fertilizers || [];
    const result = [];

    selected.forEach(name => {
        const bagsInput = document.querySelector(
            `.bags-input[data-name="${name}"]`
        );
        const totalDisplay = document.querySelector(
            `.total-display[data-name="${name}"]`
        );

        if (!bagsInput || !totalDisplay) {
            debugLog(`inputs not found for ${name}`);
            return;
        }

        const bags = Number(bagsInput.value);
        const total = Number(totalDisplay.textContent);

        const f = fertilizerDict[name];

        const row = {
            fertilizer_id: f.id,
            name,
            bags,
            total_kg: total,
            category: String(f.category || "").trim(),
            materialType: String(f.materialType || "fertilizer"),
            sourceMaster: String(f.sourceMaster || "fertilizer-index")
        };

        debugLog("row:", row);

        result.push(row);
    });

    debugLog("getFertilizerInputData result:", result);
    return result;
}
