/* ============================================================
   数値フォーマット（カンマ + 小数点2桁）
============================================================ */
export function fmt(num) {
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
   STEP1：年間フレーム（合計列つき）
============================================================ */
export function renderStep1(step1) {
  if (!step1 || !step1.months) return "<p>STEP1 データなし</p>";

  const months = step1.months;

  // 月列
  const monthCols = months.map(m => `<th>${shortMonth(m.month)}</th>`).join("");

  // 合計値
  const total_targetUnits = months.reduce((s, m) => s + (m.targetUnits ?? 0), 0);
  const total_needArea = months.reduce((s, m) => s + (m.needArea ?? 0), 0);

  // 平均値
  const avg_unitsPer10a = months.reduce((s, m) => s + (m.unitsPer10a ?? 0), 0) / months.length;
  const avg_yieldPer10a = months.reduce((s, m) => s + (m.yieldPer10a ?? 0), 0) / months.length;

  // 行データ
  const row_targetUnits = months.map(m => `<td class="num">${fmt(m.targetUnits)}</td>`).join("");
  const row_unitsPer10a = months.map(m => `<td class="num">${fmt(m.unitsPer10a)}</td>`).join("");
  const row_yieldPer10a = months.map(m => `<td class="num">${fmt(m.yieldPer10a)}</td>`).join("");
  const row_needArea = months.map(m => `<td class="num">${fmt(m.needArea)}</td>`).join("");

  return `
    <h3>STEP1：年間フレーム</h3>

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
          <tr class="row-targetUnits">
            <th>目標基数</th>
            ${row_targetUnits}
            <td class="num total-col">${fmt(total_targetUnits)}</td>
          </tr>

          <tr class="row-unitsPer10a">
            <th>基/反</th>
            ${row_unitsPer10a}
            <td class="num total-col">${fmt(avg_unitsPer10a)}</td>
          </tr>

          <tr class="row-yieldPer10a">
            <th>目標反収(kg)</th>
            ${row_yieldPer10a}
            <td class="num total-col">${fmt(avg_yieldPer10a)}</td>
          </tr>

          <tr class="row-needArea">
            <th>必要面積(反)</th>
            ${row_needArea}
            <td class="num total-col">${fmt(total_needArea)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  `;
}

/* ============================================================
   STEP2：週別作付計画（現状版）
============================================================ */
export function renderStep2(step2) {
  if (!step2 || !step2.rows) return "<p>STEP2 データなし</p>";

  const rows = Object.values(step2.rows);
  if (rows.length === 0) return "<p>STEP2 データなし</p>";

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
