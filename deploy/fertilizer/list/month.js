// fertilizer/list/month.js

import {
  loadAllFertilizerLogs
} from "./list-utils.js?v=1";

/* ============================================================
   URL パラメータ取得
============================================================ */
function getParams() {
  const url = new URL(location.href);
  return {
    year: Number(url.searchParams.get("year")),
    month: Number(url.searchParams.get("month")),
    fert: url.searchParams.get("fert")
  };
}

/* ============================================================
   初期化
============================================================ */
async function init() {
  const { year, month, fert } = getParams();

  document.getElementById("page-title").textContent =
    `${year}年 ${month}月 「${fert}」 施肥詳細`;

  const logs = await loadAllFertilizerLogs();

  const container = document.getElementById("fertilizer-detail-container");
  container.innerHTML = "";

  const table = createDetailTable(logs, year, month, fert);
  container.appendChild(table);
}

/* ============================================================
   詳細テーブル生成
============================================================ */
function createDetailTable(logs, year, month, fertName) {
  const table = document.createElement("table");
  table.className = "fert-detail-table";

  table.innerHTML = `
    <thead>
      <tr>
        <th>圃場</th>
        <th>日付</th>
        <th>施肥量（kg）</th>
        <th>作業者</th>
        <th>メモ</th>
      </tr>
    </thead>
  `;

  const tbody = document.createElement("tbody");

  logs.forEach(field => {
    if (field.year !== year) return;

    field.entries.forEach(e => {
      const m = Number(e.date.slice(5, 7));
      if (m !== month) return;

      if (!e.distributed) return;

      e.distributed.forEach(f => {
        if (f.name !== fertName) return;

        const tr = document.createElement("tr");

        tr.innerHTML = `
          <td>${field.field}</td>
          <td>${e.date}</td>
          <td>${f.amount_kg}</td>
          <td>${e.workers || ""}</td>
          <td>${e.notes || ""}</td>
        `;

        tbody.appendChild(tr);
      });
    });
  });

  table.appendChild(tbody);
  return table;
}

init();
