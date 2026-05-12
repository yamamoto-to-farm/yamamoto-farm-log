// common/filter/filter-active.js
// 旧 filter.js の「現在のフィルタ表示」を新フィルタに追加する

import { getFilter, resetFilter } from "./filter-core.js?v=1";

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

  /* -------------------------------
     年月
  -------------------------------- */
  state.yearMonths.forEach(ym => {
    const id = "tag-" + Math.random().toString(36).slice(2);
    html += createTag(ym, id);
    tagList.push({ id, handler: () => removeYM(ym) });
  });

  /* -------------------------------
     圃場
  -------------------------------- */
  state.fields.forEach(f => {
    const id = "tag-" + Math.random().toString(36).slice(2);
    html += createTag(f, id);
    tagList.push({ id, handler: () => removeField(f) });
  });

  /* -------------------------------
     品種
  -------------------------------- */
  state.varieties.forEach(v => {
    const id = "tag-" + Math.random().toString(36).slice(2);
    html += createTag(v, id);
    tagList.push({ id, handler: () => removeVariety(v) });
  });

  /* -------------------------------
     肥料（★追加）
  -------------------------------- */
  state.fertilizers?.forEach(f => {
    const id = "tag-" + Math.random().toString(36).slice(2);
    html += createTag(f, id);
    tagList.push({ id, handler: () => removeFertilizer(f) });
  });

  /* -------------------------------
     全解除ボタン
  -------------------------------- */
  if (
    state.yearMonths.length ||
    state.fields.length ||
    state.varieties.length ||
    state.fertilizers?.length
  ) {
    html += `<button id="activeFilterReset" class="filter-reset-btn">全解除</button>`;
  }

  box.innerHTML = html;

  /* -------------------------------
     個別 × のイベントをまとめて付ける
  -------------------------------- */
  tagList.forEach(t => {
    const el = document.getElementById(t.id);
    if (el) el.onclick = t.handler;
  });

  /* -------------------------------
     全解除
  -------------------------------- */
  const resetBtn = document.getElementById("activeFilterReset");
  if (resetBtn) resetBtn.onclick = resetFilter;
}

/* ------------------------------------------------------------
   タグ生成（イベントは後で付ける）
------------------------------------------------------------ */
function createTag(label, id) {
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

function removeFertilizer(f) {
  const state = getFilter();
  state.fertilizers = state.fertilizers.filter(v => v !== f);
  window.dispatchEvent(new CustomEvent("filter:apply", { detail: state }));
}
