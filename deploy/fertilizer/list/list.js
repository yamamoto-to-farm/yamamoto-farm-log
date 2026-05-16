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

  // ★ ここで一括集計（高速化の核心）
  const usage = buildUsageIndex(logs);

  const container = document.getElementById("fertilizer-container");
  container.innerHTML = "";

  years.forEach(year => {
    const block = document.createElement("div");
    block.className = "year-block";

    const title = document.createElement("h2");
    title.className = "year-title";
    title.textContent = `${year}年`;
    block.appendChild(title);

    const categories = groupByCategory(master);

    Object.keys(categories).forEach(cat => {
      const table = createCategoryTable(year, categories[cat], usage);

      if (!table) return; // ★ 空カテゴリは非表示

      const details = document.createElement("details");
      details.className = "cat-block";
      details.open = true;

      const summary = document.createElement("summary");
      summary.textContent = `${cat}`;
      details.appendChild(summary);

      details.appendChild(table);
      block.appendChild(details);
    });

    container.appendChild(block);
  });
}

/* ============================================================
   ★ 高速化の核心：使用量インデックスを構築
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
   カテゴリ内のテーブル生成
============================================================ */
function createCategoryTable(year, fertList, usage) {
  const table = document.createElement("table");
  table.className = "fert-table";

  table.innerHTML = `
    <thead>
      <tr>
        <th class="sticky-col">肥料名</th>
        ${[...Array(12).keys()].map(m => `<th>${m + 1}月</th>`).join("")}
        <th>合計</th>
      </tr>
    </thead>
  `;

  const tbody = document.createElement("tbody");
  let hasRow = false;

  fertList.forEach(fert => {
    const row = createFertilizerRow(fert, year, usage);
    if (row) {
      hasRow = true;
      tbody.appendChild(row);
    }
  });

  if (!hasRow) return null;

  table.appendChild(tbody);
  return table;
}

/* ============================================================
   肥料1行を生成（高速版）
============================================================ */
function createFertilizerRow(fert, year, usage) {
  const monthly = usage[year]?.[fert.name] || Array(13).fill(0);
  const total = monthly.reduce((a, b) => a + b, 0);

  if (total === 0) return null;

  const tr = document.createElement("tr");

  tr.innerHTML = `
    <td class="sticky-col">${fert.name}</td>
    ${monthly
      .slice(1)
      .map((v, i) => {
        const cls = v === 0 ? "zero" : "value";
        return `
          <td class="${cls} clickable"
              onclick="location.href='month.html?year=${year}&month=${i+1}&fert=${encodeURIComponent(fert.name)}'">
            ${v}
          </td>`;
      })
      .join("")}
    <td class="total">${total}</td>
  `;

  return tr;
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
