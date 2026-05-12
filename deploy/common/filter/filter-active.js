// common/filter/filter-active.js

import { filterState, getFilter, resetFilter } from "./filter-core.js?v=1";

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
  const tagList = [];

  // 年月
  state.yearMonths.forEach(ym => {
    const id = "tag-" + Math.random().toString(36).slice(2);
    html += createTag(ym, id);
    tagList.push({ id, handler: () => removeYM(ym) });
  });

  // 圃場
  state.fields.forEach(f => {
    const id = "tag-" + Math.random().toString(36).slice(2);
    html += createTag(f, id);
    tagList.push({ id, handler: () => removeField(f) });
  });

  // 品種
  state.varieties.forEach(v => {
    const id = "tag-" + Math.random().toString(36).slice(2);
    html += createTag(v, id);
    tagList.push({ id, handler: () => removeVariety(v) });
  });

  // 肥料
  state.fertilizers?.forEach(f => {
    const id = "tag-" + Math.random().toString(36).slice(2);
    html += createTag(f, id);
    tagList.push({ id, handler: () => removeFertilizer(f) });
  });

  // 全解除
  if (
    state.yearMonths.length ||
    state.fields.length ||
    state.varieties.length ||
    state.fertilizers?.length
  ) {
    html += `<button id="activeFilterReset" class="filter-reset-btn">全解除</button>`;
  }

  box.innerHTML = html;

  // 個別 ×
  tagList.forEach(t => {
    const el = document.getElementById(t.id);
    if (el) el.onclick = t.handler;
  });

  // 全解除
  const resetBtn = document.getElementById("activeFilterReset");
  if (resetBtn) resetBtn.onclick = resetFilter;
}

function createTag(label, id) {
  return `
    <span class="filter-tag">
      ${label}
      <span id="${id}" class="filter-tag-remove">×</span>
    </span>
  `;
}

/* -------------------------------
   個別削除（★ filterState を直接更新）
-------------------------------- */
function removeYM(ym) {
  filterState.yearMonths = filterState.yearMonths.filter(v => v !== ym);
  window.dispatchEvent(new CustomEvent("filter:apply"));
}

function removeField(f) {
  filterState.fields = filterState.fields.filter(v => v !== f);
  window.dispatchEvent(new CustomEvent("filter:apply"));
}

function removeVariety(v) {
  filterState.varieties = filterState.varieties.filter(v2 => v2 !== v);
  window.dispatchEvent(new CustomEvent("filter:apply"));
}

function removeFertilizer(f) {
  filterState.fertilizers = filterState.fertilizers.filter(v => v !== f);
  window.dispatchEvent(new CustomEvent("filter:apply"));
}
