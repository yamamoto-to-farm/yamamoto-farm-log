// /common/fertilizer/fertilizer-multi-input.js

import { filterState } from "/common/filter/filter-core.js?v=1";

/* ============================================================
   肥料辞書（name → full object）
   fertilizer-index.json を読み込んだ fertilizer.js からセットされる
============================================================ */
export let fertilizerDict = {};

export function setFertilizerDict(dict) {
  fertilizerDict = dict;
}

/* ============================================================
   複数肥料入力 UI を描画
============================================================ */
export function renderFertilizerInputs() {
  const area = document.getElementById("fertilizer-input-area");
  if (!area) return;

  const selected = filterState.fertilizers || [];

  if (selected.length === 0) {
    area.innerHTML = `<p class="no-fertilizer">肥料が選択されていません</p>`;
    return;
  }

  // UI を生成
  area.innerHTML = selected.map(name => {
    const f = fertilizerDict[name] || {};
    const capacity = f.capacity || 0;

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
}

/* ============================================================
   入力イベント（袋数 → 合計kg 自動計算）
============================================================ */
function initInputEvents() {
  document.querySelectorAll(".bags-input").forEach(input => {
    input.addEventListener("input", () => {
      const name = input.dataset.name;
      const bags = Number(input.value);

      const f = fertilizerDict[name];
      const capacity = f.capacity || 0;

      const total = bags * capacity;

      const totalInput = document.querySelector(
        `.total-input[data-name="${name}"]`
      );
      if (totalInput) totalInput.value = total;
    });
  });
}

/* ============================================================
   保存用データを取得
   → fertilizer.js の saveData() から呼び出す
============================================================ */
export function getFertilizerInputData() {
  const selected = filterState.fertilizers || [];
  const result = [];

  selected.forEach(name => {
    const bagsInput = document.querySelector(
      `.bags-input[data-name="${name}"]`
    );
    const totalInput = document.querySelector(
      `.total-input[data-name="${name}"]`
    );

    if (!bagsInput || !totalInput) return;

    const bags = Number(bagsInput.value);
    const total = Number(totalInput.value);

    const f = fertilizerDict[name];

    result.push({
      fertilizer_id: f.id,
      name,
      bags,
      total_kg: total
    });
  });

  return result;
}
