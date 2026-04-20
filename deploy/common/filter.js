/* ============================================================
   /common/filter.js
   階層フィルタ UI（年→月、エリア→圃場、type→品種）
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

  // 初期状態は閉じる
  document.getElementById("filter-body").style.display = "none";

  createParentChildTags("yearTags", "monthTags", years, months, filterState.years, filterState.months);
  createParentChildTags("fieldAreaTags", "fieldTags", Object.keys(fields), fields, filterState.fields, filterState.fields);
  createParentChildTags("varietyTypeTags", "varietyTags", Object.keys(varieties), varieties, filterState.varieties, filterState.varieties);

  setupAccordion();
  setupApplyButton(onApply);
  setupClearButton();
  updateActiveFilters();
}

/* ============================================================
   親 → 子 の階層タグ生成
============================================================ */
function createParentChildTags(parentId, childId, parentItems, childMap, parentState, childState) {
  const parentRoot = document.getElementById(parentId);
  const childRoot = document.getElementById(childId);

  parentRoot.innerHTML = "";
  childRoot.innerHTML = "";

  parentItems.forEach(parent => {
    const tag = document.createElement("div");
    tag.className = "filter-tag";
    tag.textContent = parent;

    tag.addEventListener("click", () => {
      const isActive = tag.classList.contains("active");

      // クリア
      if (isActive) {
        tag.classList.remove("active");
        parentState.splice(parentState.indexOf(parent), 1);

        // 子も全部クリア
        childMap[parent].forEach(c => {
          const idx = childState.indexOf(c);
          if (idx >= 0) childState.splice(idx, 1);
        });

        updateChildTags(childRoot, childState);
        updateActiveFilters();
        return;
      }

      // 選択
      tag.classList.add("active");
      parentState.push(parent);

      // 子を全部選択
      childMap[parent].forEach(c => {
        if (!childState.includes(c)) childState.push(c);
      });

      updateChildTags(childRoot, childState);
      updateActiveFilters();
    });

    parentRoot.appendChild(tag);
  });

  // 子タグ生成
  updateChildTags(childRoot, childState);
}

/* ============================================================
   子タグの更新
============================================================ */
function updateChildTags(root, stateArray) {
  root.innerHTML = "";

  const allChildren = Object.values(stateArray).flat();

  allChildren.forEach(item => {
    const tag = document.createElement("div");
    tag.className = "filter-tag";
    tag.textContent = item;

    if (stateArray.includes(item)) tag.classList.add("active");

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
   アコーディオン
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
   選択中フィルタ表示
============================================================ */
function updateActiveFilters() {
  const box = document.getElementById("activeFilters");

  const parts = [];

  if (filterState.years.length) parts.push(`年：${filterState.years.join(", ")}`);
  if (filterState.months.length) parts.push(`月：${filterState.months.join(", ")}`);
  if (filterState.fields.length) parts.push(`圃場：${filterState.fields.join(", ")}`);
  if (filterState.varieties.length) parts.push(`品種：${filterState.varieties.join(", ")}`);

  if (parts.length === 0) {
    box.style.display = "none";
    box.innerHTML = "";
    return;
  }

  box.style.display = "block";
  box.innerHTML = `
    <strong>現在のフィルタ：</strong><br>
    ${parts.join("<br>")}
    <div style="margin-top:10px;">
      <button class="primary-btn" id="applyTop">適用</button>
      <button class="secondary-btn" id="clearTop">クリア</button>
    </div>
  `;

  document.getElementById("applyTop").addEventListener("click", () => {
    const event = new Event("applyFilter");
    document.dispatchEvent(event);
  });

  document.getElementById("clearTop").addEventListener("click", () => clearFilter());
}

/* ============================================================
   クリア
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
   適用
============================================================ */
function setupApplyButton(onApply) {
  const btn = document.querySelector("#filter-actions .primary-btn");
  if (!btn) return;

  btn.addEventListener("click", () => {
    if (typeof onApply === "function") onApply(getFilterState());
  });

  document.addEventListener("applyFilter", () => {
    if (typeof onApply === "function") onApply(getFilterState());
  });
}

export function getFilterState() {
  return structuredClone(filterState);
}
