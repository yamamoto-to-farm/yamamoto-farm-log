// common/filter/filter-core.js

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

/* ▼ これを追加！ */
export function getFilter() {
  return JSON.parse(JSON.stringify(filterState));
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
