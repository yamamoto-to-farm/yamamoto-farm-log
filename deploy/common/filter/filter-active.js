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
  const pestBox  = document.getElementById("activePesticideFilters");
  const machineBox = document.getElementById("activeMachineFilters");

  const state = getFilter();

  updateFilterTriggerState(state);

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

  /* -------------------------------
     農薬タグ（★正しい位置）
  -------------------------------- */
  if (pestBox) {
    let html = "";
    const tagList = [];

    state.pesticides.forEach(p => {
      const id = "tag-" + Math.random().toString(36).slice(2);
      html += createTag(p, id);
      tagList.push({ id, handler: () => removePesticide(p) });
    });

    if (state.pesticides.length) {
      html += `<button id="pestFilterReset" class="filter-reset-btn">全解除</button>`;
    }

    pestBox.innerHTML = html;

    tagList.forEach(t => {
      const el = document.getElementById(t.id);
      if (el) el.onclick = t.handler;
    });

    const resetBtn = document.getElementById("pestFilterReset");
    if (resetBtn) resetBtn.onclick = () => {
      filterState.pesticides = [];
      window.dispatchEvent(new CustomEvent("filter:apply"));
    };
  }

  /* -------------------------------
     機械タグ
  -------------------------------- */
  if (machineBox) {
    let html = "";
    const tagList = [];

    state.machines.forEach(m => {
      const id = "tag-" + Math.random().toString(36).slice(2);
      html += createTag(m, id);
      tagList.push({ id, handler: () => removeMachine(m) });
    });

    if (state.machines.length) {
      html += `<button id="machineFilterReset" class="filter-reset-btn">全解除</button>`;
    }

    machineBox.innerHTML = html;

    tagList.forEach(t => {
      const el = document.getElementById(t.id);
      if (el) el.onclick = t.handler;
    });

    const resetBtn = document.getElementById("machineFilterReset");
    if (resetBtn) resetBtn.onclick = () => {
      filterState.machines = [];
      window.dispatchEvent(new CustomEvent("filter:apply"));
    };
  }
}

function updateFilterTriggerState(state) {
  const rules = {
    year: Array.isArray(state.yearMonths) && state.yearMonths.length > 0,
    field: Array.isArray(state.fields) && state.fields.length > 0,
    variety: Array.isArray(state.varieties) && state.varieties.length > 0,
    fertilizer: Array.isArray(state.fertilizers) && state.fertilizers.length > 0,
    pesticide: Array.isArray(state.pesticides) && state.pesticides.length > 0,
    machine: Array.isArray(state.machines) && state.machines.length > 0
  };

  document.querySelectorAll(".filter-open-btn[data-type], .filter-launch-btn[data-type]").forEach(el => {
    const type = String(el.getAttribute("data-type") || "").trim();
    const active = !!rules[type];
    el.classList.toggle("is-active", active);
  });
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

function removePesticide(p) {
  filterState.pesticides = filterState.pesticides.filter(v => v !== p);
  window.dispatchEvent(new CustomEvent("filter:apply"));
}

function removeMachine(m) {
  filterState.machines = filterState.machines.filter(v => v !== m);
  window.dispatchEvent(new CustomEvent("filter:apply"));
}
