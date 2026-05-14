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
   詳細テーブル生成（合計行つき）
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

  let totalAmount = 0;

  logs.forEach(field => {
    if (field.year !== year) return;

    field.entries.forEach(e => {
      const m = Number(e.date.slice(5, 7));
      if (m !== month) return;

      if (!e.distributed) return;

      e.distributed.forEach(f => {
        if (f.name !== fertName) return;

        const amount = Number(f.amount_kg || 0);
        totalAmount += amount;

        const tr = document.createElement("tr");

        const fieldLink = `
          <a href="https://d3sscxnlo0qnhe.cloudfront.net/fields/index.html?field=${encodeURIComponent(field.field)}"
             class="field-link">
            ${field.field}
          </a>
        `;

        tr.innerHTML = `
          <td>${fieldLink}</td>
          <td>${e.date}</td>
          <td class="value">${amount}</td>
          <td>${e.workers || ""}</td>
          <td>${e.notes || ""}</td>
        `;

        tbody.appendChild(tr);
      });
    });
  });

  /* ---------- 合計行を追加 ---------- */
  const totalRow = document.createElement("tr");
  totalRow.className = "total-row";

  totalRow.innerHTML = `
    <td colspan="2" style="font-weight:bold; background:#f0f0f0;">合計</td>
    <td class="total" style="font-weight:bold; background:#fdfdfd;">${totalAmount}</td>
    <td colspan="2"></td>
  `;

  tbody.appendChild(totalRow);

  table.appendChild(tbody);
  return table;
}

init();
