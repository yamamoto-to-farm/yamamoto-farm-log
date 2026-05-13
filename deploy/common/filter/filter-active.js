// common/filter/filter-active.js

import { filterState, getFilter, resetFilter } from "./filter-core.js?v=1";

export function initActiveFilterUI() {
  updateActiveFilterUI();
  window.addEventListener("filter:apply", updateActiveFilterUI);
  window.addEventListener("filter:reset", updateActiveFilterUI);
}

export function updateActiveFilterUI() {

  const fieldBox = document.getElementById("activeFieldFilters");
  const fertBox  = document.getElementById("activeFertilizerFilters");

  const state = getFilter();

  /* -------------------------------
     圃場タグ
  -------------------------------- */
  if (fieldBox) {
    let html = "";
    const tagList = [];

    state.fields.forEach(f => {
      const id = "tag-" + Math.random().toString(36).slice(2);
      html += createTag(f, id);
      tagList.push({ id, handler: () => removeField(f) });
    });

    if (state.fields.length) {
      html += `<button id="fieldFilterReset" class="filter-reset-btn">全解除</button>`;
    }

    fieldBox.innerHTML = html;

    tagList.forEach(t => {
      const el = document.getElementById(t.id);
      if (el) el.onclick = t.handler;
    });

    const resetBtn = document.getElementById("fieldFilterReset");
    if (resetBtn) resetBtn.onclick = () => {
      filterState.fields = [];
      window.dispatchEvent(new CustomEvent("filter:apply"));
    };
  }

  /* -------------------------------
     肥料タグ
  -------------------------------- */
  if (fertBox) {
    let html = "";
    const tagList = [];

    state.fertilizers.forEach(f => {
      const id = "tag-" + Math.random().toString(36).slice(2);
      html += createTag(f, id);
      tagList.push({ id, handler: () => removeFertilizer(f) });
    });

    if (state.fertilizers.length) {
      html += `<button id="fertFilterReset" class="filter-reset-btn">全解除</button>`;
    }

    fertBox.innerHTML = html;

    tagList.forEach(t => {
      const el = document.getElementById(t.id);
      if (el) el.onclick = t.handler;
    });

    const resetBtn = document.getElementById("fertFilterReset");
    if (resetBtn) resetBtn.onclick = () => {
      filterState.fertilizers = [];
      window.dispatchEvent(new CustomEvent("filter:apply"));
    };
  }
}

  /* -------------------------------
     農薬タグ
  -------------------------------- */
  const pestBox = document.getElementById("activePesticideFilters");

  if (pestBox) {
    let html = "";
    const tagList = [];

    state.selectedPesticides.forEach(p => {
      const id = "tag-" + Math.random().toString(36).slice(2);
      html += createTag(p, id);
      tagList.push({ id, handler: () => removePesticide(p) });
    });

    if (state.selectedPesticides.length) {
      html += `<button id="pestFilterReset" class="filter-reset-btn">全解除</button>`;
    }

    pestBox.innerHTML = html;

    tagList.forEach(t => {
      const el = document.getElementById(t.id);
      if (el) el.onclick = t.handler;
    });

    const resetBtn = document.getElementById("pestFilterReset");
    if (resetBtn) resetBtn.onclick = () => {
      filterState.selectedPesticides = [];
      window.dispatchEvent(new CustomEvent("filter:apply"));
    };
  }

/* ------------------------------------------------------------
   タグ生成
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
function removeField(f) {
  filterState.fields = filterState.fields.filter(v => v !== f);
  window.dispatchEvent(new CustomEvent("filter:apply"));
}

function removeFertilizer(f) {
  filterState.fertilizers = filterState.fertilizers.filter(v => v !== f);
  window.dispatchEvent(new CustomEvent("filter:apply"));
}
