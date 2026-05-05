// annual-list.js（フィルタ削除版 + annual.json 表示）

import { loadJSON } from "/common/json.js";

/* ============================================================
   初期化
============================================================ */
window.addEventListener("DOMContentLoaded", async () => {

  const annualAll = await loadAnnualAll();
  renderYearTable(annualAll);

  document.getElementById("loadAnnual").addEventListener("click", () => {
    renderAnnualDetail(annualAll);
  });
});

/* ============================================================
   annual.json 読み込み
============================================================ */
async function loadAnnualAll() {
  try {
    return await loadJSON("/logs/schedule/annual/annual.json");
  } catch {
    console.warn("annual.json が存在しません → 空で開始");
    return {};
  }
}

/* ============================================================
   年度一覧テーブル（編集リンク）
============================================================ */
function renderYearTable(annualAll) {

  const years = Object.keys(annualAll).sort();

  let html = `
    <table>
      <thead>
        <tr>
          <th>年</th>
          <th>状態</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
  `;

  for (const y of years) {
    html += `
      <tr>
        <td>${y}</td>
        <td>作成済み</td>
        <td class="action-links">
          <a href="/schedule/annual/index.html?year=${y}">編集</a>
          <a href="/schedule/plan.html?year=${y}">播種・定植計画へ</a>
        </td>
      </tr>
    `;
  }

  html += `</tbody></table>`;

  document.getElementById("table-area").innerHTML = html;
}

/* ============================================================
   annual.json の内容を表として表示（印刷用）
============================================================ */
function renderAnnualDetail(annualAll) {

  let html = "";

  for (const year of Object.keys(annualAll).sort()) {
    const data = annualAll[year];

    html += `<h2>${year} 年</h2>`;

    /* --- STEP1 --- */
    html += `
      <h3>STEP1：月別目標</h3>
      <table>
        <thead>
          <tr>
            <th>月</th>
            <th>目標基数</th>
            <th>基/反</th>
            <th>目標反収</th>
            <th>必要面積(反)</th>
          </tr>
        </thead>
        <tbody>
    `;

    data.step1.months.forEach(m => {
      html += `
        <tr>
          <td>${m.month}</td>
          <td>${m.targetUnits}</td>
          <td>${m.unitsPer10a}</td>
          <td>${m.yieldPer10a}</td>
          <td>${m.needArea}</td>
        </tr>
      `;
    });

    html += `</tbody></table>`;

    /* --- STEP2 --- */
    html += `
      <h3>STEP2：品種別計画</h3>
      <table>
        <thead>
          <tr>
            <th>収穫週</th>
            <th>品種</th>
            <th>目標基数</th>
            <th>基/反</th>
            <th>必要面積(反)</th>
            <th>播種日</th>
            <th>定植日</th>
          </tr>
        </thead>
        <tbody>
    `;

    data.step2.rows.forEach(r => {
      html += `
        <tr>
          <td>${r.harvestWeek}</td>
          <td>${r.variety}</td>
          <td>${r.targetUnits}</td>
          <td>${r.per10a}</td>
          <td>${r.needArea}</td>
          <td>${r.sowDate}</td>
          <td>${r.plantDate}</td>
        </tr>
      `;
    });

    html += `</tbody></table>`;
  }

  document.getElementById("printArea").innerHTML = html;
}
