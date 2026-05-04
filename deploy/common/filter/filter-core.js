/* ============================================================
   filter-core.js
   新フィルタシステムのコア（状態管理・イベント発火のみ）
   UI は別ファイルで実装する
============================================================ */

export const filterState = {
  year: null,          // "2026"
  months: [],          // ["01","02"]
  yearMonths: [],      // ["2026-01","2026-02"]
  fields: [],          // ["赤沢(上)"]
  varieties: []        // ["CTみかさ"]
};

/* ============================================================
   状態のセット
============================================================ */
export function setFilter(key, value) {
  if (!(key in filterState)) {
    console.warn(`Unknown filter key: ${key}`);
    return;
  }

  filterState[key] = value;

  // 年 + 月 → yearMonths を自動生成
  if (key === "year" || key === "months") {
    updateYearMonths();
  }

  dispatchChange();
}

/* ============================================================
   状態の追加（配列用）
============================================================ */
export function addFilterValue(key, value) {
  if (!Array.isArray(filterState[key])) return;

  if (!filterState[key].includes(value)) {
    filterState[key].push(value);
    dispatchChange();
  }
}

/* ============================================================
   状態の削除（配列用）
============================================================ */
export function removeFilterValue(key, value) {
  if (!Array.isArray(filterState[key])) return;

  filterState[key] = filterState[key].filter(v => v !== value);
  dispatchChange();
}

/* ============================================================
   年 + 月 → yearMonths を自動生成
============================================================ */
function updateYearMonths() {
  const y = filterState.year;
  const ms = filterState.months;

  if (!y || ms.length === 0) {
    filterState.yearMonths = [];
    return;
  }

  filterState.yearMonths = ms.map(m => `${y}-${m}`);
}

/* ============================================================
   状態の取得
============================================================ */
export function getFilter() {
  return JSON.parse(JSON.stringify(filterState));
}

/* ============================================================
   全解除
============================================================ */
export function resetFilter() {
  filterState.year = null;
  filterState.months = [];
  filterState.yearMonths = [];
  filterState.fields = [];
  filterState.varieties = [];

  dispatchReset();
}

/* ============================================================
   イベント発火
============================================================ */
function dispatchChange() {
  window.dispatchEvent(new CustomEvent("filter2:change", {
    detail: getFilter()
  }));
}

function dispatchReset() {
  window.dispatchEvent(new Event("filter2:reset"));
}
