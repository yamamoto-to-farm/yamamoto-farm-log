// kpi-render.js
// KPI テーブル描画（HTML生成）

export function renderKpiTable(planArea, areaMonthly, actuals, targets, year) {
  let html = `
    <table class="kpi-table">
      <thead>
        <tr>
          <th>月</th>
          <th>予定面積(反)</th>
          <th>収穫面積(反)</th>
          <th>差分(反)</th>
          <th>目標収量(kg)</th>
          <th>収穫実績(kg)</th>
          <th>出荷目標(基)</th>
          <th>出荷実績(基)</th>
        </tr>
      </thead>
      <tbody>
  `;

  for (let m = 0; m < 12; m++) {
    const diff = areaMonthly[m] - planArea[m];
    const diffClass =
      diff > 0 ? "diff-positive" :
      diff < 0 ? "diff-negative" :
      "diff-zero";

    html += `
      <tr>
        <td><a href="/performance/kpi-month.html?year=${year}&month=${m + 1}">${m + 1}月</a></td>
        <td>${planArea[m].toFixed(2)}</td>
        <td>${areaMonthly[m].toFixed(2)}</td>
        <td class="${diffClass}">${diff > 0 ? "+" : ""}${diff.toFixed(2)}</td>
        <td>${Math.round(targets.targetKg[m]).toLocaleString()}</td>
        <td>${Math.round(actuals.kg[m]).toLocaleString()}</td>
        <td>${Math.round(targets.targetUnits[m]).toLocaleString()}</td>
        <td>${Math.round(actuals.units[m]).toLocaleString()}</td>
      </tr>
    `;
  }

  html += "</tbody></table>";
  return html;
}

// ===============================
// ★ 修正ポイント：<details open> を付ける
// ===============================
export function renderYearBlock(year) {
  return `
    <details open>
      <summary>${year} 年</summary>
      <div id="kpi-${year}" class="kpi-block">読み込み中...</div>
    </details>
  `;
}
