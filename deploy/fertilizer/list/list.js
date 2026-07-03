// fertilizer/list/list.js

import {
  loadFertilizerMaster,
  loadAllFertilizerLogs,
  collectYears
} from "./list-utils.js?v=1";
import { loadJSON } from "/common/json.js?v=1";
import { openFertilizerModal } from "/common/filter/filter-fertilizer.js?v=1";
import { openFieldModal } from "/common/filter/filter-field.js?v=1";
import { setFilterData, filterState } from "/common/filter/filter-core.js?v=1";
import { initActiveFilterUI } from "/common/filter/filter-active.js?v=1";

const viewState = {
  master: [],
  usage: {},
  years: [],
  fields: []
};

/* ============================================================
   初期化
============================================================ */
export async function initFertilizerList() {
  const [master, logs, fields] = await Promise.all([
    loadFertilizerMaster(),
    loadAllFertilizerLogs(),
    loadJSON("/data/fields.json").catch(() => [])
  ]);
  const years = collectYears(logs);

  // ★ 高速化の核心：全ログを一括集計
  const usage = buildUsageIndex(logs);

  viewState.master = master;
  viewState.usage = usage;
  viewState.years = years;
  viewState.fields = Array.isArray(fields) ? fields : [];

  setupFilterUi(master, years);
  renderList();
}

function setupFilterUi(master, years) {
  const yearSelect = document.getElementById("year-select");
  const openFieldBtn = document.getElementById("open-field-modal");
  const openBtn = document.getElementById("open-fertilizer-modal");

  if (yearSelect) {
    yearSelect.innerHTML = years
      .map(y => `<option value="${y}">${y}年</option>`)
      .join("");
  }

  const categories = groupByCategory(master);

  const areaChildren = {};
  const areaParents = [];
  (viewState.fields || []).forEach(f => {
    const area = f.area || "未分類";
    if (!areaChildren[area]) {
      areaChildren[area] = [];
      areaParents.push(area);
    }
    areaChildren[area].push(f.name);
  });

  setFilterData({
    fields: {
      parents: areaParents,
      children: areaChildren
    },
    fertilizers: {
      parents: Object.keys(categories),
      children: Object.fromEntries(
        Object.entries(categories).map(([cat, list]) => [cat, list.map(v => v.name)])
      )
    }
  });

  filterState.fields = [];
  filterState.fertilizers = [];
  initActiveFilterUI();

  if (openFieldBtn) {
    openFieldBtn.onclick = () => openFieldModal({ mode: "filter" });
  }

  if (openBtn) {
    openBtn.onclick = () => openFertilizerModal({ mode: "filter" });
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

  const selectedNames = new Set(filterState.fertilizers || []);
  const hasFilter = selectedNames.size > 0;
  const selectedFields = new Set(filterState.fields || []);
  const hasFieldFilter = selectedFields.size > 0;

  const container = document.getElementById("fertilizer-container");
  if (!container) return;

  const categories = groupByCategory(master);
  let html = `<div class="year-block"><h2 class="year-title">${selectedYear}年</h2>`;

  Object.keys(categories).forEach(cat => {
    const list = hasFilter
      ? categories[cat].filter(f => selectedNames.has(f.name))
      : categories[cat];

    const tableHTML = createCategoryTableHTML(selectedYear, list, usage);
    const filteredTableHTML = createCategoryTableHTML(selectedYear, list, usage, {
      selectedFields,
      hasFieldFilter
    });
    if (!filteredTableHTML) return;

    html += `
      <details class="cat-block" open>
        <summary>${cat}</summary>
        ${filteredTableHTML}
      </details>
    `;
  });

  html += `</div>`;
  container.innerHTML = html;
}

/* ============================================================
   ★ 全ログを一括集計（高速化の核心）
============================================================ */
function buildUsageIndex(logs) {
  const usage = {}; // usage[year][fertName] = { monthly, byField }

  logs.forEach(field => {
    const year = field.year;
    if (!usage[year]) usage[year] = {};

    field.entries.forEach(e => {
      if (!e.distributed) return;

      const month = Number(e.date.slice(5, 7));

      e.distributed.forEach(f => {
        const name = f.name;
        const amount = Number(f.amount_kg || 0);
        const fieldName = String(f.field || field.field || "").trim();

        if (!usage[year][name]) {
          usage[year][name] = {
            monthly: Array(13).fill(0),
            byField: {}
          };
        }

        usage[year][name].monthly[month] += amount;

        if (fieldName) {
          if (!usage[year][name].byField[fieldName]) {
            usage[year][name].byField[fieldName] = Array(13).fill(0);
          }
          usage[year][name].byField[fieldName][month] += amount;
        }
      });
    });
  });

  return usage;
}

/* ============================================================
   テーブル HTML を直接生成（DOM操作を最小化）
============================================================ */
function createCategoryTableHTML(year, fertList, usage, options = {}) {
  const selectedFields = options.selectedFields || new Set();
  const hasFieldFilter = Boolean(options.hasFieldFilter);

  let rows = "";

  fertList.forEach(fert => {
    const usageEntry = usage[year]?.[fert.name] || null;
    if (!usageEntry) return;

    const monthly = hasFieldFilter
      ? aggregateMonthlyByFields(usageEntry.byField || {}, selectedFields)
      : usageEntry.monthly || Array(13).fill(0);

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

function aggregateMonthlyByFields(byField, selectedFields) {
  const out = Array(13).fill(0);
  if (!byField || typeof byField !== "object") return out;

  Object.keys(byField).forEach(fieldName => {
    if (!selectedFields.has(fieldName)) return;

    const monthly = byField[fieldName];
    if (!Array.isArray(monthly)) return;

    for (let i = 1; i <= 12; i++) {
      out[i] += Number(monthly[i] || 0);
    }
  });

  return out;
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
