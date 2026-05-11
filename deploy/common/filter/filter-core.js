// common/filter/filter-core.js
// 旧 filter.js と互換の state を管理するコア

// ★ すべての依存モジュールをここで読み込む（バージョン指定を一元管理）
import { updateActiveFilterUI } from "./filter-active.js?v=1";
import { openModal, closeModal } from "./filter-ui.js?v=1";

// ★ 他のモジュールも再エクスポート（一貫性を保つ）
export { openModal, closeModal };

export const filterState = {
  yearMonths: [],
  fields: [],
  varieties: [],
  fertilizers: []
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
  filterState.fertilizers = [];

  window.dispatchEvent(new Event("filter:reset"));
  updateActiveFilterUI();
}
