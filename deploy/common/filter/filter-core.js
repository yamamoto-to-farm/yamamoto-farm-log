// common/filter/filter-core.js
// 旧 filter.js と互換の state を管理するコア

export const filterState = {
  yearMonths: [],
  fields: [],
  varieties: []
};

let filterData = {}; // setFilterData で受け取る

export function setFilterData(data) {
  filterData = data;
}

export function getFilterData() {
  return filterData;
}

export function applyFilter() {
  window.dispatchEvent(new CustomEvent("filter:apply", {
    detail: JSON.parse(JSON.stringify(filterState))
  }));
}

export function resetFilter() {
  filterState.yearMonths = [];
  filterState.fields = [];
  filterState.varieties = [];

  window.dispatchEvent(new Event("filter:reset"));
}
