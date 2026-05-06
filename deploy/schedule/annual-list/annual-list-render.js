/* ============================================================
   数値フォーマット（カンマ + 小数点2桁）
============================================================ */
// 整数フォーマット（カンマ区切り）
export function fmtInt(num) {
  if (num === null || num === undefined || num === "") return "";
  return Number(num).toLocaleString("ja-JP", {
    maximumFractionDigits: 0
  });
}

// 小数点2桁フォーマット（必要面積用）
export function fmtFloat(num) {
  if (num === null || num === undefined || num === "") return "";
  return Number(num).toLocaleString("ja-JP", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}


/* ============================================================
   月の短縮（2026-11 → 11月）
============================================================ */
export function shortMonth(ym) {
  const [y, m] = ym.split("-");
  return `${Number(m)}月`;
}


/* ============================================================
   STEP1：年間収穫計画（合計列つき）
============================================================ */
export function renderStep1(step1) {
  if (!step1 || !step1.months) return "<p>STEP1 データなし</p>";

  const months = step1.months;

  // 月列（短縮）
  const monthCols = months.map(m => `<th>${shortMonth(m.month)}</th>`).join("");

  /* ------------------------------------------------------------
     合計値
  ------------------------------------------------------------ */
  const total_targetUnits = months.reduce((s, m) => s + (Number(m.targetUnits) || 0), 0);
  const total_needArea = months.reduce((s, m) => s + (Number(m.needArea) || 0), 0);
  const total_yieldPer10a = months.reduce((s, m) => s + (Number(m.yieldPer10a) || 0), 0);

  /* ------------------------------------------------------------
     平均値
  ------------------------------------------------------------ */
  const avg_unitsPer10a = months.reduce((s, m) => s + (Number(m.unitsPer10a) || 0), 0) / months.length;
  const avg_yieldPer10a = months.reduce((s, m) => s + (Number(m.yieldPer10a) || 0), 0) / months.length;

  /* ------------------------------------------------------------
     行データ
  ------------------------------------------------------------ */
  const row_targetUnits = months.map(m => `<td class="num">${fmtInt(m.targetUnits)}</td>`).join("");
  const row_unitsPer10a = months.map(m => `<td class="num">${fmtInt(m.unitsPer10a)}</td>`).join("");
  const row_yieldPer10a = months.map(m => `<td class="num">${fmtInt(m.yieldPer10a)}</td>`).join("");
  const row_needArea = months.map(m => `<td class="num">${fmtFloat(m.needArea)}</td>`).join("");

  /* ------------------------------------------------------------
     HTML 出力
  ------------------------------------------------------------ */
  return `
    <h3>STEP1：年間収穫計画</h3>

    <div class="step1-wrapper">
      <table class="step1-table">
        <thead>
          <tr>
            <th>収穫月</th>
            ${monthCols}
            <th class="total-col">合計</th>
          </tr>
        </thead>

        <tbody>
          <tr>
            <th>目標基数</th>
            ${row_targetUnits}
            <td class="num total-col">${fmtInt(total_targetUnits)}</td>
          </tr>

          <tr>
            <th>基/反</th>
            ${row_unitsPer10a}
            <td class="num total-col">${fmtInt(avg_unitsPer10a)}</td>
          </tr>

          <tr>
            <th>目標反収(kg)</th>
            ${row_yieldPer10a}
            <td class="num total-col">
              ${fmtInt(total_yieldPer10a)}（${fmtInt(avg_yieldPer10a)}）
            </td>
          </tr>

          <tr>
            <th>必要面積(反)</th>
            ${row_needArea}
            <td class="num total-col">${fmtFloat(total_needArea)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  `;
}

/* ============================================================
   STEP2：月別収穫計画（集計行 + 月クリック展開）
============================================================ */
export function renderStep2(step2) {
  if (!step2 || !step2.rows || step2.rows.length === 0) {
    return `<p>STEP2 データなし</p>`;
  }

  // 月ごとにグループ化
  const groups = {};
  for (const row of step2.rows) {
    if (!groups[row.month]) groups[row.month] = [];
    groups[row.month].push(row);
  }

  let html = `<h3>STEP2：月別収穫計画</h3>`;

  for (const ym of Object.keys(groups).sort()) {
    const rows = groups[ym];

    // 月ごとの集計
    const totalUnits = rows.reduce((s, r) => s + Number(r.targetUnits || 0), 0);
    const totalArea = rows.reduce((s, r) => s + Number(r.needArea || 0), 0);

    html += `
      <h4 class="month-toggle" data-month="${ym}">
        ${shortMonth(ym)}
      </h4>

      <div id="month-${ym}" class="month-box" style="display:none;">
        <div class="step2-wrapper">
          <table class="step2-table">
            <thead>
              <tr>
                <th>区分</th>
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

    for (const r of rows) {
      html += `
        <tr>
          <td>${r.harvestWeek}</td>
          <td>${r.variety}</td>
          <td class="num">${fmtInt(r.targetUnits)}</td>
          <td class="num">${fmtInt(r.per10a)}</td>
          <td class="num">${fmtFloat(r.needArea)}</td>
          <td>${r.sowDate || ""}</td>
          <td>${r.plantDate || ""}</td>
        </tr>
      `;
    }

    // 集計行
    html += `
        <tr class="step2-total-row">
          <th>合計</th>
          <td></td>
          <td class="num">${fmtInt(totalUnits)}</td>
          <td></td>
          <td class="num">${fmtFloat(totalArea)}</td>
          <td></td>
          <td></td>
        </tr>
      </tbody>
    </table>
  </div>
</div>
    `;
  }

  return html;
}

