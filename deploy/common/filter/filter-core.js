// common/filter/filter-core.js
// 旧 filter.js と互換の state を管理するコア

// ★ すべての依存モジュールをここで読み込む（バージョン指定を一元管理）
import { updateActiveFilterUI } from "./filter-active.js?v=1";
import { openModal, closeModal } from "./filter-ui.js?v=1";

// ★ 他のモジュールも再エクスポート（一貫性を保つ）
export { openModal, closeModal };

/* ============================================================
   ★ フィルタの選択状態（state）
   - fields
   - fertilizers
   - pesticides ← ★追加
   - varieties / yearMonths は既存のまま
============================================================ */
export const filterState = {
  yearMonths: [],
  fields: [],
  varieties: [],
  fertilizers: [],
  pesticides: []   // ★ 農薬フィルタの選択状態を追加
};

/* ============================================================
   カテゴリ構造（parents / children）を保持する領域
   setFilterData() で pesticide / fertilizer のカテゴリを受け取る
============================================================ */
let filterData = {}; 

export function setFilterData(data) {
  filterData = data;
}

export function getFilterData() {
  return filterData;
}

/* ============================================================
   ★ annual-list.js が必要とするフィルタ取得関数
============================================================ */
export function getFilter() {
  // state をディープコピーして返す
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
  filterState.pesticides = [];   // ★ 農薬フィルタもリセット

  window.dispatchEvent(new Event("filter:reset"));
  updateActiveFilterUI();
}
