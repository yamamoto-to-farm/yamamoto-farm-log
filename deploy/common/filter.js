/* ============================================================
   /common/filter.js
   フィルタ UI 共通ライブラリ
============================================================ */

let filterState = {
  years: [],
  months: [],
  fields: [],
  varieties: []
};

/* ============================================================
   初期化（list.js から呼ぶ）
============================================================ */
export function initFilterUI({ years, months, fields, varieties, onApply }) {
  createTagGroup("yearTags", years, filterState.years);
  createTagGroup("monthTags", months, filterState.months);
  createTagGroup("fieldTags", fields, filterState.fields);
  createTagGroup("varietyTags", varieties, filterState.varieties);

  setupAccordion();
  setupApplyButton(onApply);
  setupClearButton();
  updateActiveFilters();
}

/* ============================================================
   タグ UI の生成
============================================================ */
function createTagGroup(rootId, items, stateArray) {
  const root = document.getElementById(rootId);
  root.innerHTML = "";

  items.forEach(item => {
    const tag = document.createElement("div");
    tag.className = "filter-tag";
    tag.textContent = item;

    tag.addEventListener("click", () => {
      const idx = stateArray.indexOf(item);
      if (idx >= 0) {
        stateArray.splice(idx, 1);
        tag.classList.remove("active");
      } else {
        stateArray.push(item);
        tag.classList.add("active");
      }
      updateActiveFilters();
    });

    root.appendChild(tag);
  });
}

/* ============================================================
   アコーディオン（開閉）
============================================================ */
function setupAccordion() {
  document.addEventListener("click", e => {
    if (e.target.classList.contains("accordion-title")) {
      const body = e.target.nextElementSibling;
      if (body) {
        body.style.display = body.style.display === "block" ? "none" : "block";
      }
    }
  });
}

/* ============================================================
   選択中フィルタの表示
============================================================ */
function updateActiveFilters() {
  const box = document.getElementById("activeFilters");

  const parts = [];

  if (filterState.years.length) parts.push(filterState.years.join("年, ") + "年");
  if (filterState.months.length) parts.push(filterState.months.join("月, ") + "月");
  if (filterState.fields.length) parts.push("圃場: " + filterState.fields.join(", "));
  if (filterState.varieties.length) parts.push("品種: " + filterState.varieties.join(", "));

  if (parts.length === 0) {
    box.style.display = "none";
    box.innerHTML = "";
    return;
  }

  box.style.display = "block";
  box.innerHTML = `
    <strong>現在のフィルタ：</strong> ${parts.join(" / ")}
    <button class="secondary-btn" id="clearFilterBtn" style="margin-left:10px;">クリア</button>
  `;

  document.getElementById("clearFilterBtn").addEventListener("click", () => {
    clearFilter();
  });
}

/* ============================================================
   フィルタクリア
============================================================ */
function setupClearButton() {
  const btn = document.querySelector("#filter-actions .secondary-btn");
  if (!btn) return;

  btn.addEventListener("click", () => clearFilter());
}

function clearFilter() {
  filterState.years.length = 0;
  filterState.months.length = 0;
  filterState.fields.length = 0;
  filterState.varieties.length = 0;

  document.querySelectorAll(".filter-tag").forEach(t => t.classList.remove("active"));

  updateActiveFilters();
}

/* ============================================================
   フィルタ適用
============================================================ */
function setupApplyButton(onApply) {
  const btn = document.querySelector("#filter-actions .primary-btn");
  if (!btn) return;

  btn.addEventListener("click", () => {
    if (typeof onApply === "function") onApply(getFilterState());
  });
}

/* ============================================================
   list.js から取得するための関数
============================================================ */
export function getFilterState() {
  return structuredClone(filterState);
}
