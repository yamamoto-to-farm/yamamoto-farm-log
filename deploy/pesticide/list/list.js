import {
  loadPesticideMaster,
  loadAllPesticideLogs,
  collectYears
} from "./list-utils.js?v=1";

export async function initPesticideList() {
  const master = await loadPesticideMaster();
  const logs = await loadAllPesticideLogs();
  const years = collectYears(logs);

  const usage = buildUsageIndex(logs);

  const container = document.getElementById("pesticide-container");
  container.innerHTML = "";

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

  if (!html) {
    html = '<div class="year-block"><h2 class="year-title">記録なし</h2><div style="padding:12px;">防除記録がありません。</div></div>';
  }

  container.innerHTML = html;
}

function buildUsageIndex(logs) {
  const usage = {};

  logs.forEach(field => {
    const year = field.year;
    if (!usage[year]) usage[year] = {};

    field.entries.forEach(e => {
      if (!Array.isArray(e.distributed)) return;
      const month = Number(String(e.date || "").slice(5, 7));
      if (!month) return;

      e.distributed.forEach(p => {
        const name = p.name;
        const amount = Number(p.water_amount ?? p.spray_amount ?? 0);

        if (!usage[year][name]) usage[year][name] = Array(13).fill(0);
        usage[year][name][month] += amount;
      });
    });
  });

  return usage;
}

function createCategoryTableHTML(year, pesticideList, usage) {
  let rows = "";

  pesticideList.forEach(pesticide => {
    const monthly = usage[year]?.[pesticide.name] || Array(13).fill(0);
    const total = monthly.reduce((a, b) => a + b, 0);
    if (total === 0) return;

    rows += `
      <tr>
        <td class="sticky-col">${escapeHtml(pesticide.name)}</td>
        ${monthly.slice(1).map((v, i) => `
          <td class="${v === 0 ? "zero" : "value"} clickable"
              onclick="location.href='month.html?year=${year}&month=${i + 1}&pesticide=${encodeURIComponent(pesticide.name)}'">
            ${formatNumber(v)}
          </td>
        `).join("")}
        <td class="total">${formatNumber(total)}</td>
      </tr>
    `;
  });

  if (!rows) return null;

  return `
    <table class="pest-table">
      <thead>
        <tr>
          <th class="sticky-col">農薬名</th>
          ${[...Array(12).keys()].map(m => `<th>${m + 1}月</th>`).join("")}
          <th>合計</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function groupByCategory(master) {
  const map = {};
  master.forEach(p => {
    if (!map[p.category]) map[p.category] = [];
    map[p.category].push(p);
  });
  return map;
}

function formatNumber(value) {
  return Number(value || 0).toFixed(1).replace(/\.0$/, "");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
