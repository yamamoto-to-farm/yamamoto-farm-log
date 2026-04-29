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

  // ===============================
  // 月別行
  // ===============================
  for (let m = 0; m < 12; m++) {
    const diff = areaMonthly[m] - planArea[m];
    const diffClass =
      diff > 0 ? "diff-positive" :
        diff < 0 ? "diff-negative" :
          "diff-zero";

    html += `
    <tr>
      <td><a href="/performance/kpi-month.html?year=${year}&month=${m + 1}">${m + 1}月</a></td>

      <!-- ★ 予定面積セルをクリック可能に -->
      <td class="plan-cell"
          data-year="${year}"
          data-month="${m}">
          ${planArea[m].toFixed(2)}
      </td>

      <td>${areaMonthly[m].toFixed(2)}</td>
      <td class="${diffClass}">${diff > 0 ? "+" : ""}${diff.toFixed(2)}</td>
      <td>${Math.round(targets.targetKg[m]).toLocaleString()}</td>
      <td>${Math.round(actuals.kg[m]).toLocaleString()}</td>
      <td>${Math.round(targets.targetUnits[m]).toLocaleString()}</td>
      <td>${Math.round(actuals.units[m]).toLocaleString()}</td>
    </tr>
  `;
  }





  // ===============================
  // ★ 年間合計行（kpi-month と同じ思想）
  // ===============================
  const totalPlan = planArea.reduce((a, b) => a + b, 0);
  const totalArea = areaMonthly.reduce((a, b) => a + b, 0);
  const totalDiff = totalArea - totalPlan;

  const totalTargetKg = targets.targetKg.reduce((a, b) => a + b, 0);
  const totalActualKg = actuals.kg.reduce((a, b) => a + b, 0);

  const totalTargetUnits = targets.targetUnits.reduce((a, b) => a + b, 0);
  const totalActualUnits = actuals.units.reduce((a, b) => a + b, 0);

  html += `
      <tr class="total-row">
        <td><strong>合計</strong></td>
        <td><strong>${totalPlan.toFixed(2)}</strong></td>
        <td><strong>${totalArea.toFixed(2)}</strong></td>
        <td><strong>${totalDiff > 0 ? "+" : ""}${totalDiff.toFixed(2)}</strong></td>
        <td><strong>${Math.round(totalTargetKg).toLocaleString()}</strong></td>
        <td><strong>${Math.round(totalActualKg).toLocaleString()}</strong></td>
        <td><strong>${Math.round(totalTargetUnits).toLocaleString()}</strong></td>
        <td><strong>${Math.round(totalActualUnits).toLocaleString()}</strong></td>
      </tr>
  `;

  html += "</tbody></table>";
  return html;

  document.querySelectorAll(".plan-cell").forEach(cell => {
  cell.addEventListener("click", () => {
    const year = Number(cell.dataset.year);
    const month = Number(cell.dataset.month);
    openPlanRefModal(year, month, refList, plantingRows);
    });
  });

}

// ===============================
// 年度ブロック（<details open>）
// ===============================
export function renderYearBlock(year) {
  return `
    <details open>
      <summary>${year} 年</summary>
      <div id="kpi-${year}" class="kpi-block">読み込み中...</div>
    </details>
  `;
}
