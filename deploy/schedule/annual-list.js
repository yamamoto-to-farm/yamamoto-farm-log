import { loadJSON } from "/common/json.js";
import { openYearSelectModal } from "/common/filter/filter-year-simple.js";

const loadBtn = document.getElementById("loadAnnual");
const tableArea = document.getElementById("table-area");
const yearSelector = document.getElementById("yearSelector");

let annualAll = null;

const DEBUG = true;

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
  }
});

/* ============================================================
   STEP1 表（横方向）
============================================================ */
function renderStep1(step1) {
  if (!step1 || !step1.months) return "<p>STEP1 データなし</p>";

  const months = step1.months;

  const monthCols = months.map(m => `<th>${m.month}</th>`).join("");

  const row_targetUnits = months.map(m => `<td>${m.targetUnits ?? ""}</td>`).join("");
  const row_unitsPer10a = months.map(m => `<td>${m.unitsPer10a ?? ""}</td>`).join("");
  const row_yieldPer10a = months.map(m => `<td>${m.yieldPer10a ?? ""}</td>`).join("");
  const row_needArea = months.map(m => `<td>${m.needArea ?? ""}</td>`).join("");

  return `
    <h3>STEP1：年間フレーム</h3>
    <table class="step1-table">
      <thead>
        <tr>
          <th>項目</th>
          ${monthCols}
        </tr>
      </thead>
      <tbody>
        <tr><th>目標基数</th>${row_targetUnits}</tr>
        <tr><th>10aあたり基数</th>${row_unitsPer10a}</tr>
        <tr><th>10aあたり収量</th>${row_yieldPer10a}</tr>
        <tr><th>必要面積</th>${row_needArea}</tr>
      </tbody>
    </table>
  `;
}

/* ============================================================
   STEP2 表（編集ページと同じ構造）
============================================================ */
function renderStep2(step2) {
  if (!step2 || !step2.rows) return "<p>STEP2 データなし</p>";

  const rows = Object.values(step2.rows);
  if (rows.length === 0) return "<p>STEP2 データなし</p>";

  // 月ごとにグループ化
  const byMonth = {};
  rows.forEach(r => {
    if (!byMonth[r.month]) byMonth[r.month] = [];
    byMonth[r.month].push(r);
  });

  let html = `<h3>STEP2：週別作付計画</h3>`;

  for (const month of Object.keys(byMonth).sort()) {
    html += `
      <h4>${month}</h4>
      <table class="step2-table">
        <thead>
          <tr>
            <th>週</th>
            <th>品目</th>
            <th>基数</th>
            <th>面積</th>
            <th>播種日</th>
            <th>定植日</th>
          </tr>
        </thead>
        <tbody>
    `;

    byMonth[month].forEach(r => {
      html += `
        <tr>
          <td>${r.week ?? ""}</td>
          <td>${r.varietyName ?? ""}</td>
          <td>${r.units ?? ""}</td>
          <td>${r.area ?? ""}</td>
          <td>${r.sowDate ?? ""}</td>
          <td>${r.plantDate ?? ""}</td>
        </tr>
      `;
    });

    html += `</tbody></table>`;
  }

  return html;
}

/* ============================================================
   年度描画（カードの中に STEP1 + STEP2）
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
