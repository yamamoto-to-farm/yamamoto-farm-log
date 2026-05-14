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
    const block = document.createElement("div");
    block.className = "year-block";

    const title = document.createElement("h2");
    title.className = "year-title";
    title.textContent = `${year}年`;
    block.appendChild(title);

    const categories = groupByCategory(master);

    Object.keys(categories).forEach(cat => {
      const table = createCategoryTable(year, categories[cat], logs);

      // ★ テーブルが null（＝1行も無い）ならカテゴリごと非表示
      if (!table) return;

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
   カテゴリ内のテーブル生成
   ★ 1行も無ければ null を返す
============================================================ */
function createCategoryTable(year, fertList, logs) {
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
    const row = createFertilizerRow(fert, year, logs);
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
   肥料1行を生成（年間合計0なら null）
============================================================ */
function createFertilizerRow(fert, year, logs) {
  const monthly = [...Array(12).keys()].map(m =>
    sumFertilizer(logs, fert.name, year, m + 1)
  );

  const total = monthly.reduce((a, b) => a + b, 0);
  if (total === 0) return null;

  const tr = document.createElement("tr");

  tr.innerHTML = `
    <td class="sticky-col">${fert.name}</td>
    ${monthly
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

/* ============================================================
   施肥量集計
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
