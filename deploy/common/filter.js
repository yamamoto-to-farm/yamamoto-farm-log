/* ============================================================
   フィルタモーダル（年月） + activeFilters + 全解除
============================================================ */

let filterData = {};

let selectedYears = [];
let selectedMonths = [];
let selectedFields = [];
let selectedVarieties = [];

/* ============================================================
   list.js からデータを受け取る
============================================================ */
export function setFilterData(data) {
  filterData = data;
}

/* ============================================================
   activeFilters の描画
============================================================ */
function renderActiveFilters() {
  const area = document.getElementById("activeFilters");
  area.innerHTML = "";

  const tags = [];

  selectedYears.forEach(y => tags.push({ type: "year", label: y }));
  selectedMonths.forEach(m => tags.push({ type: "month", label: m }));
  selectedFields.forEach(f => tags.push({ type: "field", label: f }));
  selectedVarieties.forEach(v => tags.push({ type: "variety", label: v }));

  tags.forEach(tag => {
    const div = document.createElement("div");
    div.className = "filter-tag";
    div.innerHTML = `
      ${tag.label}
      <span class="filter-tag-remove" data-type="${tag.type}" data-value="${tag.label}">×</span>
    `;
    area.appendChild(div);
  });

  /* 全解除ボタン */
  if (tags.length > 0) {
    const resetBtn = document.createElement("button");
    resetBtn.className = "filter-reset-btn";
    resetBtn.textContent = "全解除";
    resetBtn.onclick = () => resetAllFilters();
    area.appendChild(resetBtn);
  }

  /* 個別解除 */
  document.querySelectorAll(".filter-tag-remove").forEach(el => {
    el.onclick = () => {
      removeFilter(el.dataset.type, el.dataset.value);
    };
  });
}

/* ============================================================
   個別解除
============================================================ */
function removeFilter(type, value) {
  if (type === "year") selectedYears = selectedYears.filter(v => v !== value);
  if (type === "month") selectedMonths = selectedMonths.filter(v => v !== value);
  if (type === "field") selectedFields = selectedFields.filter(v => v !== value);
  if (type === "variety") selectedVarieties = selectedVarieties.filter(v => v !== value);

  applyCurrentFilters();
}

/* ============================================================
   全解除
============================================================ */
export function resetAllFilters() {
  selectedYears = [];
  selectedMonths = [];
  selectedFields = [];
  selectedVarieties = [];

  applyCurrentFilters();

  window.dispatchEvent(new Event("filter:reset"));
}

/* ============================================================
   現在のフィルタ状態を list.js に適用
============================================================ */
function applyCurrentFilters() {
  const state = {
    years: selectedYears,
    months: selectedMonths,
    fields: selectedFields,
    varieties: selectedVarieties
  };

  renderActiveFilters();
  window.dispatchEvent(new CustomEvent("filter:apply", { detail: state }));
}

/* ============================================================
   年月モーダルを開く
============================================================ */
export function openYearModal() {
  const container = document.getElementById("modal-container");
  container.innerHTML = createYearModalHTML();
  container.style.display = "block";

  initYearModalEvents();
}

/* ============================================================
   モーダルHTML生成
============================================================ */
function createYearModalHTML() {
  const years = filterData.years || [];
  const months = filterData.months || {};

  return `
    <div class="modal-bg" id="modal-bg">
      <div class="modal">
        <div class="modal-close" id="modal-close">×</div>

        <h3>年月の選択</h3>

        <h4>年</h4>
        <div id="year-list">
          ${years.map(y => `<div class="select-item" data-year="${y}">${y}</div>`).join("")}
        </div>

        <h4 style="margin-top:20px;">月</h4>
        <div id="month-list">
          ${Object.values(months).flat().sort().map(m => `
            <div class="select-item" data-month="${m}">${m}</div>
          `).join("")}
        </div>

        <div class="modal-footer">
          <button class="primary-btn" id="apply">適用</button>
          <button class="secondary-btn" id="clear">クリア</button>
        </div>
      </div>
    </div>
  `;
}

/* ============================================================
   イベント初期化
============================================================ */
function initYearModalEvents() {

  document.getElementById("modal-close").onclick = closeModal;
  document.getElementById("modal-bg").onclick = (e) => {
    if (e.target.id === "modal-bg") closeModal();
  };

  document.querySelectorAll("[data-year]").forEach(el => {
    el.onclick = () => toggleYear(el.dataset.year);
  });

  document.querySelectorAll("[data-month]").forEach(el => {
    el.onclick = () => toggleMonth(el.dataset.month);
  });

  document.getElementById("clear").onclick = () => {
    selectedYears = [];
    selectedMonths = [];
    updateSelections();
  };

  document.getElementById("apply").onclick = () => {
    applyCurrentFilters();
    closeModal();
  };
}

/* ============================================================
   年クリック
============================================================ */
function toggleYear(year) {
  const isSelected = selectedYears.includes(year);

  if (isSelected) {
    selectedYears = [];
    selectedMonths = [];
  } else {
    selectedYears = [year];
    selectedMonths = [...(filterData.months[year] || [])];
  }

  updateSelections();
}

/* ============================================================
   月クリック
============================================================ */
function toggleMonth(month) {
  if (selectedMonths.includes(month)) {
    selectedMonths = selectedMonths.filter(v => v !== month);
  } else {
    selectedMonths.push(month);
  }
  updateSelections();
}

/* ============================================================
   UI の再描画
============================================================ */
function updateSelections() {
  document.querySelectorAll("[data-year]").forEach(el => {
    el.classList.toggle("selected", selectedYears.includes(el.dataset.year));
  });

  document.querySelectorAll("[data-month]").forEach(el => {
    el.classList.toggle("selected", selectedMonths.includes(el.dataset.month));
  });
}

/* ============================================================
   モーダルを閉じる
============================================================ */
function closeModal() {
  const container = document.getElementById("modal-container");
  container.innerHTML = "";
  container.style.display = "none";
}
