// fertilizer/list/list.js

import {
  loadFertilizerMaster,
  loadAllFertilizerLogs,
  collectYears
} from "./list-utils.js?v=1";

/* ============================================================
   初期化
============================================================ */
export async function initFertilizerList() {
  const master = await loadFertilizerMaster();
  const logs = await loadAllFertilizerLogs();
  const years = collectYears(logs);

  // ★ 高速化の核心：全ログを一括集計
  const usage = buildUsageIndex(logs);
  const categories = groupByCategory(master);

  const container = document.getElementById("fertilizer-container");
  container.innerHTML = "";

  let html = "";

  years.forEach(year => {
    html += `<div class="year-block">
      <h2 class="year-title">${year}年</h2>
    `;

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

  container.innerHTML = html;
}

/* ============================================================
   ★ 全ログを一括集計（高速化の核心）
============================================================ */
function buildUsageIndex(logs) {
  const usage = {}; // usage[year][fertName][month] = kg

  logs.forEach(field => {
    const year = field.year;
    if (!usage[year]) usage[year] = {};

    field.entries.forEach(e => {
      if (!e.distributed) return;

      const month = Number(e.date.slice(5, 7));

      e.distributed.forEach(f => {
        const name = f.name;
        const amount = Number(f.amount_kg || 0);

        if (!usage[year][name]) usage[year][name] = Array(13).fill(0);
        usage[year][name][month] += amount;
      });
    });
  });

  return usage;
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

/* ============================================================
   カテゴリごとにまとめる
============================================================ */
function groupByCategory(master) {
  const map = {};
  master.forEach(f => {
    if (!map[f.category]) map[f.category] = [];
    map[f.category].push(f);
  });
  return map;
}
