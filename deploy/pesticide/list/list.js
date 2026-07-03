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
    import { openpesticideModal } from "/common/filter/filter-pesticide.js?v=1";
    import { setFilterData, filterState } from "/common/filter/filter-core.js?v=1";
    import { initActiveFilterUI } from "/common/filter/filter-active.js?v=1";

    const viewState = {
      master: [],
      usage: {},
      years: []
    };
  }

      const [master, logs] = await Promise.all([
        loadPesticideMaster(),
        loadAllPesticideLogs()
      ]);

function buildUsageIndex(logs) {
  const usage = {};

      viewState.master = master;
      viewState.usage = usage;
      viewState.years = years;

      setupFilterUi(master, years);
      renderList();
    }

    function setupFilterUi(master, years) {
      const yearSelect = document.getElementById("year-select");
      const openBtn = document.getElementById("open-pesticide-modal");

      if (yearSelect) {
        yearSelect.innerHTML = years
          .map(y => `<option value="${y}">${y}年</option>`)
          .join("");
      }

      const categories = groupByCategory(master);
      setFilterData({
        pesticides: {
          parents: Object.keys(categories),
          children: Object.fromEntries(
            Object.entries(categories).map(([cat, list]) => [cat, list.map(v => v.name)])
          )
        }
      });

      filterState.pesticides = [];
      initActiveFilterUI();

      if (openBtn) {
        openBtn.onclick = () => openpesticideModal({ mode: "filter" });
      }

      if (yearSelect) {
        yearSelect.onchange = () => renderList();
      }

      window.addEventListener("filter:apply", () => renderList());
      window.addEventListener("filter:reset", () => renderList());
    }

    function renderList() {
      const yearSelect = document.getElementById("year-select");
      const selectedYear = Number(yearSelect?.value || viewState.years[0] || 0);
      const master = viewState.master;
      const usage = viewState.usage;

      const selectedNames = new Set(filterState.pesticides || []);
      const hasFilter = selectedNames.size > 0;

  logs.forEach(field => {
      if (!container) return;

      const categories = groupByCategory(master);
      let html = `<div class="year-block"><h2 class="year-title">${selectedYear}年</h2>`;

      Object.keys(categories).forEach(cat => {
        const list = hasFilter
          ? categories[cat].filter(p => selectedNames.has(p.name))
          : categories[cat];

        const tableHTML = createCategoryTableHTML(selectedYear, list, usage);
        if (!tableHTML) return;

        html += `
          <details class="cat-block" open>
            <summary>${escapeHtml(cat)}</summary>
            ${tableHTML}
          </details>
        `;
      });
    const year = field.year;
      html += `</div>`;
    const total = monthly.reduce((a, b) => a + b, 0);
    if (total === 0) return;
        html = '<div class="year-block"><h2 class="year-title">記録なし</h2><div style="padding:12px;">防除記録がありません。</div></div>';
    rows += `
      <tr>
        <td class="sticky-col">${escapeHtml(pesticide.name)}</td>
        ${monthly.slice(1).map((v, i) => `
          <td class="${v === 0 ? "zero" : "value"} clickable"
              onclick="location.href='month.html?year=${year}&month=${i + 1}&pesticide=${encodeURIComponent(pesticide.name)}'">
            ${formatAmount(v)}
          </td>
        `).join("")}
        <td class="total">${formatAmount(total)}</td>
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

function formatAmount(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return "0";

  const rounded = Math.round(n * 10) / 10;
  const hasDecimal = Math.abs(rounded % 1) > 0;

  return hasDecimal
    ? rounded.toLocaleString("ja-JP", { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    : rounded.toLocaleString("ja-JP");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
