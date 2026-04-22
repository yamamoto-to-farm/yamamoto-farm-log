/* ============================================================
   年月フィルタ（折りたたみ式・スマホ対応・年月ペア方式）
============================================================ */

let filterData = {};
let selectedYearMonths = []; // ← "2025-12" のように保持

/* ============================================================
   list.js からデータを受け取る
============================================================ */
export function setFilterData(data) {
  filterData = data; // { years: [...], months: {2025:[...], ...} }
}

/* ============================================================
   activeFilters の描画
============================================================ */
function renderActiveFilters() {
  const area = document.getElementById("activeFilters");
  area.innerHTML = "";

  selectedYearMonths.forEach(ym => {
    const div = document.createElement("div");
    div.className = "filter-tag";
    div.innerHTML = `
      ${ym}
      <span class="filter-tag-remove" data-ym="${ym}">×</span>
    `;
    area.appendChild(div);
  });

  if (selectedYearMonths.length > 0) {
    const resetBtn = document.createElement("button");
    resetBtn.className = "filter-reset-btn";
    resetBtn.textContent = "全解除";
    resetBtn.onclick = () => resetAllFilters();
    area.appendChild(resetBtn);
  }

  document.querySelectorAll(".filter-tag-remove").forEach(el => {
    el.onclick = () => {
      const ym = el.dataset.ym;
      selectedYearMonths = selectedYearMonths.filter(v => v !== ym);
      applyCurrentFilters();
    };
  });
}

/* ============================================================
   全解除
============================================================ */
export function resetAllFilters() {
  selectedYearMonths = [];
  applyCurrentFilters();
  window.dispatchEvent(new Event("filter:reset"));
}

/* ============================================================
   現在のフィルタ状態を list.js に適用
============================================================ */
function applyCurrentFilters() {
  const state = { yearMonths: selectedYearMonths };
  renderActiveFilters();
  window.dispatchEvent(new CustomEvent("filter:apply", { detail: state }));
}

/* ============================================================
   モーダルを開く
============================================================ */
export function openYearModal() {
  const container = document.getElementById("modal-container");
  container.innerHTML = createYearModalHTML();
  container.style.display = "block";
  initYearModalEvents();
}

/* ============================================================
   モーダルHTML生成（折りたたみ式）
============================================================ */
function createYearModalHTML() {
  const years = filterData.years || [];
  const months = filterData.months || {};

  return `
    <div class="modal-bg" id="modal-bg">
      <div class="modal">
        <div class="modal-close" id="modal-close">×</div>

        <h3>年月の選択</h3>

        <div id="year-month-block">
          ${years.map(y => `
            <div class="year-block" data-year="${y}">
              <div class="year-header">
                <span class="year-label" data-year="${y}">${y}</span>
                <span class="toggle-btn" data-year="${y}">▼</span>
              </div>
              <div class="month-row">
                ${(months[y] || []).map(m => `
                  <div class="select-item" data-ym="${y}-${m}">${m}</div>
                `).join("")}
              </div>
            </div>
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
   イベント初期化（スマホ対応）
============================================================ */
function initYearModalEvents() {

  // 閉じる
  document.getElementById("modal-close").addEventListener("click", closeModal);

  // 背景クリック（スマホ対応）
  document.getElementById("modal-bg").addEventListener("click", (e) => {
    if (e.target.classList.contains("modal-bg")) closeModal();
  });

  // ▼ ボタン → 展開/折りたたみ
  document.querySelectorAll(".toggle-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const block = btn.closest(".year-block");
      block.classList.toggle("open");
    });
  });

  // 年ラベル → 全月選択/解除
  document.querySelectorAll(".year-label").forEach(label => {
    label.addEventListener("click", () => {
      const year = label.dataset.year;
      toggleYearAll(year);
    });
  });

  // 月クリック → 年月ペアをトグル
  document.querySelectorAll("[data-ym]").forEach(el => {
    el.addEventListener("click", () => toggleYearMonth(el.dataset.ym));
  });

  // クリア
  document.getElementById("clear").addEventListener("click", () => {
    selectedYearMonths = [];
    updateSelections();
  });

  // 適用
  document.getElementById("apply").addEventListener("click", () => {
    applyCurrentFilters();
    closeModal();
  });

  updateSelections();
}

/* ============================================================
   年月ペアクリック
============================================================ */
function toggleYearMonth(ym) {
  if (selectedYearMonths.includes(ym)) {
    selectedYearMonths = selectedYearMonths.filter(v => v !== ym);
  } else {
    selectedYearMonths.push(ym);
  }
  updateSelections();
}

/* ============================================================
   年クリック（全月トグル）
============================================================ */
function toggleYearAll(year) {
  const months = filterData.months[year] || [];
  const ymList = months.map(m => `${year}-${m}`);

  const allSelected = ymList.every(ym => selectedYearMonths.includes(ym));

  if (allSelected) {
    selectedYearMonths = selectedYearMonths.filter(v => !ymList.includes(v));
  } else {
    ymList.forEach(ym => {
      if (!selectedYearMonths.includes(ym)) selectedYearMonths.push(ym);
    });
  }

  updateSelections();
}

/* ============================================================
   UI の再描画
============================================================ */
function updateSelections() {
  document.querySelectorAll("[data-ym]").forEach(el => {
    el.classList.toggle("selected", selectedYearMonths.includes(el.dataset.ym));
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
