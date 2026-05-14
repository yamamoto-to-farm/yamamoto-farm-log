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

  const container = document.getElementById("fertilizer-container");
  container.innerHTML = "";

  years.forEach(year => {
    const section = document.createElement("div");
    section.className = "year-section";

    const title = document.createElement("h2");
    title.textContent = `${year}年`;
    section.appendChild(title);

    const table = createYearTable(year, master, logs);
    section.appendChild(table);

    container.appendChild(section);
  });
}

/* ============================================================
   年ごとの施肥一覧テーブル生成
============================================================ */
function createYearTable(year, master, logs) {
  const table = document.createElement("table");
  table.className = "fert-year-table";

  /* ---------- ヘッダー ---------- */
  const thead = document.createElement("thead");
  thead.innerHTML = `
    <tr>
      <th class="sticky-col">カテゴリ</th>
      <th class="sticky-col2">肥料名</th>
      ${[...Array(12).keys()].map(m => `<th>${m + 1}月</th>`).join("")}
      <th>合計</th>
    </tr>
  `;
  table.appendChild(thead);

  /* ---------- ボディ ---------- */
  const tbody = document.createElement("tbody");

  // カテゴリごとにまとめる
  const categories = groupByCategory(master);

  Object.keys(categories).forEach(cat => {
    const details = document.createElement("details");
    details.open = true;

    const summary = document.createElement("summary");
    summary.textContent = `${cat}（${categories[cat].length}種類）`;
    details.appendChild(summary);

    const innerTable = document.createElement("table");
    innerTable.className = "inner-cat-table";

    const innerBody = document.createElement("tbody");

    categories[cat].forEach(fert => {
      const row = createFertilizerRow(fert, year, logs);
      if (row) innerBody.appendChild(row); // 年間合計0は非表示
    });

    innerTable.appendChild(innerBody);
    details.appendChild(innerTable);

    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 15;
    td.appendChild(details);
    tr.appendChild(td);

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);

  return table;
}

/* ============================================================
   肥料1行を生成（年間合計0なら null を返す）
============================================================ */
function createFertilizerRow(fert, year, logs) {
  const monthly = [...Array(12).keys()].map(m =>
    sumFertilizer(logs, fert.name, year, m + 1)
  );

  const total = monthly.reduce((a, b) => a + b, 0);

  if (total === 0) return null; // 年間合計0は非表示

  const tr = document.createElement("tr");
  tr.dataset.cat = fert.category;

  tr.innerHTML = `
    <td class="sticky-col">${fert.category}</td>
    <td class="sticky-col2">${fert.name}</td>
    ${monthly
      .map((v, i) => {
        const cls = v === 0 ? "zero" : "value";
        return `
          <td class="${cls}" onclick="location.href='month.html?year=${year}&fert=${encodeURIComponent(fert.name)}&month=${i+1}'">
            ${v}
          </td>`;
      })
      .join("")}
    <td class="total">${total}</td>
  `;

  return tr;
}

/* ============================================================
   カテゴリごとに肥料をまとめる
============================================================ */
function groupByCategory(master) {
  const map = {};
  master.forEach(f => {
    if (!map[f.category]) map[f.category] = [];
    map[f.category].push(f);
  });
  return map;
}

/* ============================================================
   施肥量集計（肥料 × 年 × 月）
============================================================ */
function sumFertilizer(logs, fertName, year, month) {
  let sum = 0;

  logs.forEach(field => {
    if (field.year !== year) return;

    field.entries.forEach(e => {
      if (!e.distributed) return;

      const m = Number(e.date.slice(5, 7));
      if (m !== month) return;

      e.distributed.forEach(f => {
        if (f.name === fertName) {
          sum += Number(f.amount_kg || 0);
        }
      });
    });
  });

  return sum;
}
