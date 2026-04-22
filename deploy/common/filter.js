/* ============================================================
   年月フィルタ ＋ 圃場フィルタ（折りたたみ式・スマホ対応）
============================================================ */

let filterData = {};
let selectedYearMonths = [];   // "2025-12"
let selectedFields = [];       // "赤沢(上)"

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

  // 年月
  selectedYearMonths.forEach(ym => {
    const div = document.createElement("div");
    div.className = "filter-tag";
    div.innerHTML = `${ym}<span class="filter-tag-remove" data-ym="${ym}">×</span>`;
    area.appendChild(div);
  });

  // 圃場
  selectedFields.forEach(f => {
    const div = document.createElement("div");
    div.className = "filter-tag";
    div.innerHTML = `${f}<span class="filter-tag-remove" data-field="${f}">×</span>`;
    area.appendChild(div);
  });

  if (selectedYearMonths.length > 0 || selectedFields.length > 0) {
    const resetBtn = document.createElement("button");
    resetBtn.className = "filter-reset-btn";
    resetBtn.textContent = "全解除";
    resetBtn.onclick = () => resetAllFilters();
    area.appendChild(resetBtn);
  }

  document.querySelectorAll(".filter-tag-remove").forEach(el => {
    if (el.dataset.ym) {
      el.onclick = () => {
        selectedYearMonths = selectedYearMonths.filter(v => v !== el.dataset.ym);
        applyCurrentFilters();
      };
    }
    if (el.dataset.field) {
      el.onclick = () => {
        selectedFields = selectedFields.filter(v => v !== el.dataset.field);
        applyCurrentFilters();
      };
    }
  });
}

/* ============================================================
   全解除
============================================================ */
export function resetAllFilters() {
  selectedYearMonths = [];
  selectedFields = [];
  applyCurrentFilters();
  window.dispatchEvent(new Event("filter:reset"));
}

/* ============================================================
   現在のフィルタ状態を list.js に適用
============================================================ */
function applyCurrentFilters() {
  const state = {
    yearMonths: selectedYearMonths,
    fields: selectedFields
  };
  renderActiveFilters();
  window.dispatchEvent(new CustomEvent("filter:apply", { detail: state }));
}

/* ============================================================
   ▼ 年フィルタモーダル
============================================================ */
export function openYearModal() {
  const container = document.getElementById("modal-container");
  container.innerHTML = createYearModalHTML();
  container.style.display = "block";
  initYearModalEvents();
}

function createYearModalHTML() {
  const years = filterData.years || [];
  const months = filterData.months || {};

  return `
    <div class="modal-bg" id="modal-bg">
      <div class="modal">
        <div class="modal-close" id="modal-close">×</div>

        <h3>年月の選択</h3>

        ${years.map(y => `
          <div class="filter-block" data-year="${y}">
            <div class="filter-header">
              <span class="filter-label" data-year="${y}">${y}</span>
              <span class="filter-toggle-btn" data-year="${y}">▼</span>
            </div>
            <div class="filter-children">
              ${(months[y] || []).map(m => `
                <div class="select-item" data-ym="${y}-${m}">${m}</div>
              `).join("")}
            </div>
          </div>
        `).join("")}

        <div class="modal-footer">
          <button class="primary-btn" id="apply">適用</button>
          <button class="secondary-btn" id="clear">クリア</button>
        </div>
      </div>
    </div>
  `;
}

function initYearModalEvents() {

  document.getElementById("modal-close").addEventListener("click", closeModal);
  document.getElementById("modal-bg").addEventListener("click", (e) => {
    if (e.target.classList.contains("modal-bg")) closeModal();
  });

  document.querySelectorAll(".filter-toggle-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      btn.closest(".filter-block").classList.toggle("open");
    });
  });

  document.querySelectorAll(".filter-label").forEach(label => {
    label.addEventListener("click", () => toggleYearAll(label.dataset.year));
  });

  document.querySelectorAll("[data-ym]").forEach(el => {
    el.addEventListener("click", () => toggleYearMonth(el.dataset.ym));
  });

  document.getElementById("clear").addEventListener("click", () => {
    selectedYearMonths = [];
    updateYearSelections();
  });

  document.getElementById("apply").addEventListener("click", () => {
    applyCurrentFilters();
    closeModal();
  });

  updateYearSelections();
}

function toggleYearMonth(ym) {
  if (selectedYearMonths.includes(ym)) {
    selectedYearMonths = selectedYearMonths.filter(v => v !== ym);
  } else {
    selectedYearMonths.push(ym);
  }
  updateYearSelections();
}

function toggleYearAll(year) {
  const list = (filterData.months[year] || []).map(m => `${year}-${m}`);
  const allSelected = list.every(ym => selectedYearMonths.includes(ym));

  if (allSelected) {
    selectedYearMonths = selectedYearMonths.filter(v => !list.includes(v));
  } else {
    list.forEach(ym => {
      if (!selectedYearMonths.includes(ym)) selectedYearMonths.push(ym);
    });
  }
  updateYearSelections();
}

function updateYearSelections() {
  document.querySelectorAll("[data-ym]").forEach(el => {
    el.classList.toggle("selected", selectedYearMonths.includes(el.dataset.ym));
  });
}

/* ============================================================
   ▼ 圃場フィルタモーダル
============================================================ */
export function openFieldModal() {
  const container = document.getElementById("modal-container");
  container.innerHTML = createFieldModalHTML();
  container.style.display = "block";
  initFieldModalEvents();
}

function createFieldModalHTML() {
  const parents = filterData.fields.parents;
  const children = filterData.fields.children;

  return `
    <div class="modal-bg" id="modal-bg">
      <div class="modal">
        <div class="modal-close" id="modal-close">×</div>

        <h3>圃場の選択</h3>

        ${parents.map(area => `
          <div class="filter-block" data-area="${area}">
            <div class="filter-header">
              <span class="filter-label" data-area="${area}">${area}</span>
              <span class="filter-toggle-btn" data-area="${area}">▼</span>
            </div>
            <div class="filter-children">
              ${(children[area] || []).map(name => `
                <div class="select-item" data-field="${name}">${name}</div>
              `).join("")}
            </div>
          </div>
        `).join("")}

        <div class="modal-footer">
          <button class="primary-btn" id="apply-field">適用</button>
          <button class="secondary-btn" id="clear-field">クリア</button>
        </div>
      </div>
    </div>
  `;
}

function initFieldModalEvents() {

  document.getElementById("modal-close").addEventListener("click", closeModal);
  document.getElementById("modal-bg").addEventListener("click", (e) => {
    if (e.target.classList.contains("modal-bg")) closeModal();
  });

  document.querySelectorAll(".filter-toggle-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      btn.closest(".filter-block").classList.toggle("open");
    });
  });

  document.querySelectorAll(".filter-label").forEach(label => {
    label.addEventListener("click", () => toggleAreaAll(label.dataset.area));
  });

  document.querySelectorAll("[data-field]").forEach(el => {
    el.addEventListener("click", () => toggleField(el.dataset.field));
  });

  document.getElementById("clear-field").addEventListener("click", () => {
    selectedFields = [];
    updateFieldSelections();
  });

  document.getElementById("apply-field").addEventListener("click", () => {
    applyCurrentFilters();
    closeModal();
  });

  updateFieldSelections();
}

function toggleField(name) {
  if (selectedFields.includes(name)) {
    selectedFields = selectedFields.filter(v => v !== name);
  } else {
    selectedFields.push(name);
  }
  updateFieldSelections();
}

function toggleAreaAll(area) {
  const list = filterData.fields.children[area] || [];
  const allSelected = list.every(f => selectedFields.includes(f));

  if (allSelected) {
    selectedFields = selectedFields.filter(v => !list.includes(v));
  } else {
    list.forEach(f => {
      if (!selectedFields.includes(f)) selectedFields.push(f);
    });
  }
  updateFieldSelections();
}

function updateFieldSelections() {
  document.querySelectorAll("[data-field]").forEach(el => {
    el.classList.toggle("selected", selectedFields.includes(el.dataset.field));
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
