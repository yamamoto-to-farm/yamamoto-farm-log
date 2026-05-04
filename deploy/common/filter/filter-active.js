// common/filter/filter-active.js
// 旧 filter.js の「現在のフィルタ表示」を新フィルタに追加する

import { getFilter, resetFilter } from "./filter-core.js";

export function initActiveFilterUI() {
  updateActiveFilterUI();

  window.addEventListener("filter:apply", updateActiveFilterUI);
  window.addEventListener("filter:reset", updateActiveFilterUI);
}

export function updateActiveFilterUI() {
  const box = document.getElementById("activeFilters");
  if (!box) return;

  const state = getFilter();
  let html = "";

  // 年月
  state.yearMonths.forEach(ym => {
    html += createTag(ym, () => removeYM(ym));
  });

  // 圃場
  state.fields.forEach(f => {
    html += createTag(f, () => removeField(f));
  });

  // 品種
  state.varieties.forEach(v => {
    html += createTag(v, () => removeVariety(v));
  });

  if (state.yearMonths.length || state.fields.length || state.varieties.length) {
    html += `<button id="activeFilterReset" class="filter-reset-btn">全解除</button>`;
  }

  box.innerHTML = html;

  const resetBtn = document.getElementById("activeFilterReset");
  if (resetBtn) resetBtn.onclick = resetFilter;
}

/* ------------------------------------------------------------
   タグ生成
------------------------------------------------------------ */
function createTag(label, onRemove) {
  const id = "tag-" + Math.random().toString(36).slice(2);
  setTimeout(() => {
    const el = document.getElementById(id);
    if (el) el.onclick = onRemove;
  });

  return `
    <span class="filter-tag">
      ${label}
      <span id="${id}" class="filter-tag-remove">×</span>
    </span>
  `;
}

/* ------------------------------------------------------------
   個別削除
------------------------------------------------------------ */
function removeYM(ym) {
  const state = getFilter();
  state.yearMonths = state.yearMonths.filter(v => v !== ym);
  window.dispatchEvent(new CustomEvent("filter:apply", { detail: state }));
}

function removeField(f) {
  const state = getFilter();
  state.fields = state.fields.filter(v => v !== f);
  window.dispatchEvent(new CustomEvent("filter:apply", { detail: state }));
}

function removeVariety(v) {
  const state = getFilter();
  state.varieties = state.varieties.filter(v2 => v2 !== v);
  window.dispatchEvent(new CustomEvent("filter:apply", { detail: state }));
}
