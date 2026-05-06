import { loadJSON } from "/common/json.js";
import { openYearSelectModal } from "/common/filter/filter-year-simple.js";
import { renderStep1, renderStep2 } from "./annual-list-render.js";

const loadBtn = document.getElementById("loadAnnual");
const tableArea = document.getElementById("table-area");
const yearSelector = document.getElementById("yearSelector");

let annualAll = null;

/* ============================================================
   年度選択
============================================================ */
loadBtn.addEventListener("click", async () => {
  try {
    annualAll = await loadJSON("/logs/schedule/annual/annual.json");

    const years = Object.keys(annualAll).sort();

    openYearSelectModal({
      years,
      onSelect: (y) => {
        yearSelector.innerHTML = `<option value="${y}">${y}</option>`;
        yearSelector.value = y;
        renderSelectedYear();
      }
    });

  } catch (e) {
    tableArea.innerHTML = `<p>annual.json の読み込みに失敗しました</p>`;
    console.error(e);
  }
});

/* ============================================================
   年度描画（カード内に STEP1 + STEP2）
============================================================ */
function renderSelectedYear() {
  const y = yearSelector.value;
  const data = annualAll[y];
  const isAdmin = window.currentRole === "admin";

  if (!data) {
    tableArea.innerHTML = `
      <div class="card">
        <h2>${y} 年の作付計画</h2>
        <p>データなし（新規作成）</p>
        ${isAdmin ? `<a href="/schedule/annual/index.html?year=${y}" class="primary-btn">新規作成</a>` : ""}
      </div>
    `;
    return;
  }

  tableArea.innerHTML = `
    <div class="card">
      <h2>${y} 年の作付計画</h2>
      ${isAdmin ? `<a href="/schedule/annual/index.html?year=${y}" class="primary-btn">編集する</a>` : ""}

      <div style="margin-top:24px;">
        ${renderStep1(data.step1)}
      </div>

      <div style="margin-top:32px;">
        ${renderStep2(data.step2)}
      </div>
    </div>
  `;
}
