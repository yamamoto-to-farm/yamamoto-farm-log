/* ============================================================
   /common/filter.js
   展開（▼）と選択（チェックボックス）を分離した階層フィルタ
============================================================ */

let filterState = {
  years: [],
  months: [],
  fields: [],
  varieties: []
};

let expandState = {
  year: false,
  field: false,
  variety: false,
  children: {} // "2025": false, "赤沢・南大清水": false など
};

/* ============================================================
   初期化
============================================================ */
export function initFilterUI({ years, months, fields, varieties, onApply }) {

  // 子階層の展開状態を初期化
  years.forEach(y => expandState.children[y] = false);
  Object.keys(fields).forEach(a => expandState.children[a] = false);
  Object.keys(varieties).forEach(t => expandState.children[t] = false);

  renderFilterUI(years, months, fields, varieties);

  setupApplyButton(onApply);
  setupClearButton();
  updateActiveFilters();
}

/* ============================================================
   メイン描画
============================================================ */
function renderFilterUI(years, months, fields, varieties) {
  renderSection("year", "yearTags", "monthTags", years, months, filterState.years, filterState.months);
  renderSection("field", "fieldAreaTags", "fieldTags", Object.keys(fields), fields, filterState.fields, filterState.fields);
  renderSection("variety", "varietyTypeTags", "varietyTags", Object.keys(varieties), varieties, filterState.varieties, filterState.varieties);
}

/* ============================================================
   セクション描画（年月・圃場・品種）
============================================================ */
function renderSection(sectionKey, parentId, childId, parentItems, childMap, parentState, childState) {
  const parentRoot = document.getElementById(parentId);
  const childRoot = document.getElementById(childId);

  parentRoot.innerHTML = "";
  childRoot.innerHTML = "";

  /* ▼ セクションタイトルの展開トグル */
  const title = parentRoot.previousElementSibling;
  title.style.cursor = "pointer";
  title.textContent = (expandState[sectionKey] ? "▼ " : "▶ ") + title.textContent.replace(/^[▶▼]\s*/, "");

  title.onclick = () => {
    expandState[sectionKey] = !expandState[sectionKey];
    renderFilterUI(parentItems, childMap, null, null);
  };

  /* ▼ 親階層 */
  if (!expandState[sectionKey]) return;

  parentItems.forEach(parent => {
    const row = document.createElement("div");
    row.className = "filter-row";

    /* 展開トグル（▼） */
    const toggle = document.createElement("span");
    toggle.className = "toggle-icon";
    toggle.textContent = expandState.children[parent] ? "▼" : "▶";
    toggle.onclick = () => {
      expandState.children[parent] = !expandState.children[parent];
      renderFilterUI(parentItems, childMap, null, null);
    };

    /* 親チェックボックス */
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = parentState.includes(parent);
    cb.onchange = () => {
      if (cb.checked) {
        if (!parentState.includes(parent)) parentState.push(parent);
        (childMap[parent] || []).forEach(c => {
          if (!childState.includes(c)) childState.push(c);
        });
      } else {
        const idx = parentState.indexOf(parent);
        if (idx >= 0) parentState.splice(idx, 1);
        (childMap[parent] || []).forEach(c => {
          const i = childState.indexOf(c);
          if (i >= 0) childState.splice(i, 1);
        });
      }
      updateActiveFilters();
      renderFilterUI(parentItems, childMap, null, null);
    };

    /* 親ラベル */
    const label = document.createElement("span");
    label.textContent = parent;
    label.className = "filter-label";

    row.appendChild(toggle);
    row.appendChild(cb);
    row.appendChild(label);
    parentRoot.appendChild(row);

    /* ▼ 子階層 */
    if (expandState.children[parent]) {
      (childMap[parent] || []).forEach(child => {
        const crow = document.createElement("div");
        crow.className = "filter-row child";

        const ccb = document.createElement("input");
        ccb.type = "checkbox";
        ccb.checked = childState.includes(child);
        ccb.onchange = () => {
          if (ccb.checked) {
            if (!childState.includes(child)) childState.push(child);
          } else {
            const i = childState.indexOf(child);
            if (i >= 0) childState.splice(i, 1);
          }
          updateActiveFilters();
          renderFilterUI(parentItems, childMap, null, null);
        };

        const clabel = document.createElement("span");
        clabel.textContent = child;

        crow.appendChild(document.createElement("span")); // 空白
        crow.appendChild(ccb);
        crow.appendChild(clabel);
        childRoot.appendChild(crow);
      });
    }
  });
}

/* ============================================================
   現在のフィルタ表示
============================================================ */
function updateActiveFilters() {
  const box = document.getElementById("activeFilters");

  const parts = [];
  if (filterState.years.length) parts.push(`年：${filterState.years.join(", ")}`);
  if (filterState.months.length) parts.push(`月：${filterState.months.join(", ")}`);
  if (filterState.fields.length) parts.push(`圃場：${filterState.fields.join(", ")}`);
  if (filterState.varieties.length) parts.push(`品種：${filterState.varieties.join(", ")}`);

  if (!parts.length) {
    box.style.display = "none";
    box.innerHTML = "";
    return;
  }

  box.style.display = "block";
  box.innerHTML = `
    <div class="card">
      <strong>現在のフィルタ</strong><br>
      ${parts.join("<br>")}
      <div style="margin-top:10px;">
        <button class="primary-btn" id="applyTop">適用</button>
        <button class="secondary-btn" id="clearTop">クリア</button>
      </div>
    </div>
  `;

  document.getElementById("applyTop").onclick = () => {
    document.dispatchEvent(new Event("applyFilter"));
  };
  document.getElementById("clearTop").onclick = () => clearFilter();
}

/* ============================================================
   クリア
============================================================ */
function clearFilter() {
  filterState.years = [];
  filterState.months = [];
  filterState.fields = [];
  filterState.varieties = [];
  updateActiveFilters();
  renderFilterUI([], [], [], []);
}

/* ============================================================
   適用
============================================================ */
function setupApplyButton(onApply) {
  document.addEventListener("applyFilter", () => {
    if (typeof onApply === "function") onApply(getFilterState());
  });
}

function setupClearButton() {
  const btn = document.querySelector("#filter-actions .secondary-btn");
  if (btn) btn.onclick = () => clearFilter();
}

export function getFilterState() {
  return structuredClone(filterState);
}
