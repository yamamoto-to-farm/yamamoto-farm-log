// common/filter/filter-core.js
// 旧 filter.js と互換の state を管理するコア

import { updateActiveFilterUI } from "./filter-active.js";

export const filterState = {
  yearMonths: [],
  fields: [],
  varieties: []
};

let filterData = {}; // setFilterData で受け取る

/* ============================================================
   フィルタデータのセット / 取得
============================================================ */
export function setFilterData(data) {
  filterData = data;
}

export function getFilterData() {
  return filterData;
}

/* ============================================================
   ★ これが無いと annual-list.js が動かない
============================================================ */
export function getFilter() {
  return JSON.parse(JSON.stringify(filterState));
}

/* ============================================================
   フィルタ適用（旧 filter.js と同じイベント名）
============================================================ */
export function applyFilter() {
  window.dispatchEvent(new CustomEvent("filter:apply", {
    detail: JSON.parse(JSON.stringify(filterState))
  }));
  updateActiveFilterUI();
}

/* ============================================================
   フィルタリセット
============================================================ */
export function resetFilter() {
  filterState.yearMonths = [];
  filterState.fields = [];
  filterState.varieties = [];

  window.dispatchEvent(new Event("filter:reset"));
  updateActiveFilterUI();
}
