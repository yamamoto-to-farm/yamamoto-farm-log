// /common/fertilizer/fertilizer-multi-input.js

// ===============================
// デバッグフラグ
// ===============================
const DEBUG = true;   // ← false にすればログが一切出ない

function debugLog(...args) {
  if (DEBUG) console.log("[multi-input-debug]", ...args);
}

import { filterState } from "/common/filter/filter-core.js?v=1";

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
        <div class="fertilizer-title">${name}</div>

        <div class="fertilizer-inputs">

          <label>袋数</label>
          <input type="number"
                 class="bags-input"
                 data-name="${name}"
                 value="0"
                 min="0">

          <label>容量(kg)</label>
          <input type="number"
                 class="capacity-input"
                 value="${capacity}"
                 disabled>

          <label>合計(kg)</label>
          <input type="number"
                 class="total-input"
                 data-name="${name}"
                 value="0"
                 disabled>

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

      const totalInput = document.querySelector(
        `.total-input[data-name="${name}"]`
      );
      if (totalInput) totalInput.value = total;
    });
  });

  debugLog("initInputEvents done");
}

/* ============================================================
   保存用データを取得
   → fertilizer.js の saveData() から呼び出す
============================================================ */
export function getFertilizerInputData() {
  debugLog("getFertilizerInputData start");

  const selected = filterState.fertilizers || [];
  const result = [];

  selected.forEach(name => {
    const bagsInput = document.querySelector(
      `.bags-input[data-name="${name}"]`
    );
    const totalInput = document.querySelector(
      `.total-input[data-name="${name}"]`
    );

    if (!bagsInput || !totalInput) {
      debugLog(`inputs not found for ${name}`);
      return;
    }

    const bags = Number(bagsInput.value);
    const total = Number(totalInput.value);

    const f = fertilizerDict[name];

    const row = {
      fertilizer_id: f.id,
      name,
      bags,
      total_kg: total
    };

    debugLog("row:", row);

    result.push(row);
  });

  debugLog("getFertilizerInputData result:", result);
  return result;
}
