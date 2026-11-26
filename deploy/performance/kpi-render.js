// kpi-render.js
// KPI テーブル描画（HTML生成）

export function renderKpiTable(goalArea, plantedArea, areaMonthly, actuals, targets, year, planSources = [], sales = null) {
  const hasAnnualPlan = Array.isArray(planSources) && planSources.includes("annual");
  let html = `
    ${hasAnnualPlan ? '<div class="kpi-note">目標面積・目標収量・出荷目標は annual の STEP1 計画です。定植面積は定植記録から集計しています。</div>' : ''}
    <div class="kpi-table-scroll" tabindex="0" role="region" aria-label="${year}年の収穫KPI（横スクロール可）">
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
          ${sales ? renderKpiHeader("sales", "売上概算（税抜）") : ""}
          ${sales ? renderKpiHeader("sales-price", "平均単価") : ""}
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
      ${sales ? `<td>${year > 2026 || (year === 2026 && m >= 10)
        ? `<a href="/sales/index.html?from=${year}-${String(m + 1).padStart(2, "0")}-01&to=${year}-${String(m + 1).padStart(2, "0")}-${new Date(year, m + 1, 0).getDate()}">${salesCell(sales[m])}</a>`
        : "対象外"}</td><td>${salesPrice(sales[m])}</td>` : ""}
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
  const salesTotal = sales && sales.reduce((total, entry) => ({
    amount: total.amount + entry.amount, weight: total.weight + entry.weight,
    matched: total.matched + entry.matched, pending: total.pending + entry.pending,
  }), { amount: 0, weight: 0, matched: 0, pending: 0 });

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
        ${sales ? `<td><strong>${salesCell(salesTotal)}</strong></td><td><strong>${salesPrice(salesTotal)}</strong></td>` : ""}
      </tr>
  `;

  html += "</tbody></table></div>";
  return html;

  document.querySelectorAll(".plan-cell").forEach(cell => {
  cell.addEventListener("click", () => {
    const year = Number(cell.dataset.year);
    const month = Number(cell.dataset.month);
    openPlanRefModal(year, month, refList, plantingRows);
    });
  });

}

function salesCell(value) {
  if (!value.matched) return value.pending ? "未確定" : "—";
  return `${Math.round(value.amount).toLocaleString()}円${value.pending ? "（一部未確定）" : ""}`;
}

function salesPrice(value) {
  return value.weight ? `${(value.amount / value.weight).toLocaleString("ja-JP", { maximumFractionDigits: 2 })}円/kg${value.pending ? "（一部未確定）" : ""}` : "—";
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
