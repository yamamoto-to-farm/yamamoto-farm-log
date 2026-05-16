export async function initFertilizerList() {
  const master = await loadFertilizerMaster();
  const logs = await loadAllFertilizerLogs();
  const years = collectYears(logs);

  const usage = buildUsageIndex(logs);

  const container = document.getElementById("fertilizer-container");
  container.innerHTML = "";

  // ★ DOM を文字列で構築して最後に一括挿入（爆速化の核心）
  let html = "";

  years.forEach(year => {
    html += `<div class="year-block">
      <h2 class="year-title">${year}年</h2>
    `;

    const categories = groupByCategory(master);

    Object.keys(categories).forEach(cat => {
      const tableHTML = createCategoryTableHTML(year, categories[cat], usage);
      if (!tableHTML) return;

      html += `
        <details class="cat-block">
          <summary>${cat}</summary>
          ${tableHTML}
        </details>
      `;
    });

    html += `</div>`;
  });

  // ★ 一括挿入（ここが最重要）
  container.innerHTML = html;
}

/* ============================================================
   テーブル HTML を直接生成（DOM操作を最小化）
============================================================ */
function createCategoryTableHTML(year, fertList, usage) {
  let rows = "";

  fertList.forEach(fert => {
    const monthly = usage[year]?.[fert.name] || Array(13).fill(0);
    const total = monthly.reduce((a, b) => a + b, 0);
    if (total === 0) return;

    rows += `
      <tr>
        <td class="sticky-col">${fert.name}</td>
        ${monthly.slice(1).map((v, i) => `
          <td class="${v === 0 ? "zero" : "value"} clickable"
              onclick="location.href='month.html?year=${year}&month=${i+1}&fert=${encodeURIComponent(fert.name)}'">
            ${v}
          </td>
        `).join("")}
        <td class="total">${total}</td>
      </tr>
    `;
  });

  if (!rows) return null;

  return `
    <table class="fert-table">
      <thead>
        <tr>
          <th class="sticky-col">肥料名</th>
          ${[...Array(12).keys()].map(m => `<th>${m + 1}月</th>`).join("")}
          <th>合計</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}
