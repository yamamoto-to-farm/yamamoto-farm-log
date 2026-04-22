/* ============================================================
   フィルタモーダル（年月） - 完全新規
============================================================ */

let filterData = {}; // list.js から受け取る

// 選択状態
let selectedYears = [];
let selectedMonths = [];

/* ============================================================
   list.js からデータを受け取る
============================================================ */
export function setFilterData(data) {
  filterData = data;
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

  // 閉じる
  document.getElementById("modal-close").onclick = closeModal;
  document.getElementById("modal-bg").onclick = (e) => {
    if (e.target.id === "modal-bg") closeModal();
  };

  // 年クリック
  document.querySelectorAll("[data-year]").forEach(el => {
    el.onclick = () => toggleYear(el.dataset.year);
  });

  // 月クリック
  document.querySelectorAll("[data-month]").forEach(el => {
    el.onclick = () => toggleMonth(el.dataset.month);
  });

  // クリア
  document.getElementById("clear").onclick = () => {
    selectedYears = [];
    selectedMonths = [];
    updateSelections();
  };

  // 適用
  document.getElementById("apply").onclick = () => {
    const state = {
      years: selectedYears,
      months: selectedMonths,
      fields: [],
      varieties: []
    };

    window.dispatchEvent(new CustomEvent("filter:apply", { detail: state }));
    closeModal();
  };
}

/* ============================================================
   年クリック → 全月選択 or 全解除
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
   月クリック → 個別選択
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
   UI の再描画（色変更）
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

/* ============================================================
   圃場・品種（後で実装）
============================================================ */
export function openFieldModal() {
  alert("圃場モーダルはまだ未実装です");
}

export function openVarietyModal() {
  alert("品種モーダルはまだ未実装です");
}
