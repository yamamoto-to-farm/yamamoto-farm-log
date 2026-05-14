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
      <th>カテゴリ</th>
      <th>肥料名</th>
      ${[...Array(12).keys()].map(m => `<th>${m + 1}月</th>`).join("")}
    </tr>
  `;
  table.appendChild(thead);

  /* ---------- ボディ ---------- */
  const tbody = document.createElement("tbody");

  master.forEach(fert => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${fert.category}</td>
      <td>${fert.name}</td>
      ${[...Array(12).keys()]
        .map(m => `<td>${sumFertilizer(logs, fert.name, year, m + 1)}</td>`)
        .join("")}
    `;

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);

  return table;
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
