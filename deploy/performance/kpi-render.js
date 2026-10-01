// kpi-render.js
// KPI テーブル描画（HTML生成）

export function renderKpiTable(goalArea, plantedArea, areaMonthly, actuals, targets, year, planSources = []) {
  const hasAnnualPlan = Array.isArray(planSources) && planSources.includes("annual");
  let html = `
    ${hasAnnualPlan ? '<div class="kpi-note">目標面積・目標収量・出荷目標は annual の STEP1 計画です。定植面積は定植記録から集計しています。</div>' : ''}
    <table class="kpi-table">
      <thead>
        <tr>
          ${renderKpiHeader("month", "月")}
          ${renderKpiHeader("goal-area", "目標面積(反)")}
          ${renderKpiHeader("planted-area", "定植面積(反)")}
          ${renderKpiHeader("harvest-area", "収穫面積(反)")}
          ${renderKpiHeader("area-diff", "差分(反)")}
          ${renderKpiHeader("target-kg", "目標収量(kg)")}
          ${renderKpiHeader("actual-kg", "収穫実績(kg)")}
          ${renderKpiHeader("target-units", "出荷目標(基)")}
          ${renderKpiHeader("actual-units", "出荷実績(基)")}
        </tr>
      </thead>
      <tbody>
  `;

  // ===============================
  // 月別行
  // ===============================
  for (let m = 0; m < 12; m++) {
    const diff = areaMonthly[m] - plantedArea[m];
    const diffClass =
      diff > 0 ? "diff-positive" :
        diff < 0 ? "diff-negative" :
          "diff-zero";

    html += `
    <tr>
      <td><a href="/performance/kpi-month.html?year=${year}&month=${m + 1}">${m + 1}月</a></td>
      <td>${goalArea[m] == null ? "—" : goalArea[m].toFixed(2)}</td>
      <td class="plan-cell"
          data-year="${year}"
          data-month="${m}"
          data-plan-source="planting">
          ${plantedArea[m].toFixed(2)}
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
  const totalGoalArea = goalArea.reduce((sum, value) => sum + (Number(value) || 0), 0);
  const totalPlantedArea = plantedArea.reduce((a, b) => a + b, 0);
  const totalArea = areaMonthly.reduce((a, b) => a + b, 0);
  const totalDiff = totalArea - totalPlantedArea;

  const totalTargetKg = targets.targetKg.reduce((a, b) => a + b, 0);
  const totalActualKg = actuals.kg.reduce((a, b) => a + b, 0);

  const totalTargetUnits = targets.targetUnits.reduce((a, b) => a + b, 0);
  const totalActualUnits = actuals.units.reduce((a, b) => a + b, 0);

  html += `
      <tr class="total-row">
        <td><strong>合計</strong></td>
        <td><strong>${totalGoalArea.toFixed(2)}</strong></td>
        <td><strong>${totalPlantedArea.toFixed(2)}</strong></td>
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

function renderKpiHeader(key, label) {
  return `<th><span class="kpi-header-label">${label}</span><button type="button" class="kpi-help-button" data-kpi-help="${key}" aria-label="${label}の説明" title="${label}の説明">?</button></th>`;
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
