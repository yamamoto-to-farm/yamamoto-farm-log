// fertilizer/list/month.js

import {
  loadAllFertilizerLogs,
  getFertilizerByName
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
  const fertInfo = await getFertilizerByName(fert); // ★ capacity 取得

  const container = document.getElementById("fertilizer-detail-container");
  container.innerHTML = "";

  const blocks = createDateBlocks(logs, year, month, fert, fertInfo);
  blocks.forEach(b => container.appendChild(b));

  container.appendChild(createMonthlyTotal(blocks));
}

/* ============================================================
   日付ごとにブロック化（案1 + 袋数対応）
============================================================ */
function createDateBlocks(logs, year, month, fertName, fertInfo) {
  const rows = [];

  logs.forEach(field => {
    if (field.year !== year) return;

    field.entries.forEach(e => {
      const m = Number(e.date.slice(5, 7));
      if (m !== month) return;

      if (!e.distributed) return;

      e.distributed.forEach(f => {
        if (f.name !== fertName) return;

        const amount = Number(f.amount_kg || 0);
        const bags = fertInfo?.capacity
          ? amount / fertInfo.capacity
          : null;

        rows.push({
          field: field.field,
          date: e.date,
          amount,
          bags,
          workers: e.workers || "",
          notes: e.notes || ""
        });
      });
    });
  });

  /* ---------- 日付昇順でソート ---------- */
  rows.sort((a, b) => (a.date > b.date ? 1 : -1));

  /* ---------- 日付ごとにグループ化 ---------- */
  const groups = {};
  rows.forEach(r => {
    if (!groups[r.date]) groups[r.date] = [];
    groups[r.date].push(r);
  });

  /* ---------- ブロック生成 ---------- */
  const blocks = [];

  Object.keys(groups).forEach(date => {
    const list = groups[date];

    const totalKg = list.reduce((a, b) => a + b.amount, 0);
    const totalBags = fertInfo?.capacity
      ? list.reduce((a, b) => a + b.bags, 0)
      : null;

    const details = document.createElement("details");
    details.className = "date-block";
    details.open = true;

    const summary = document.createElement("summary");
    summary.innerHTML = `
      ${date}（${list.length}圃場 / ${totalKg}kg${totalBags !== null ? ` / ${totalBags.toFixed(2)}袋` : ""}）
    `;
    details.appendChild(summary);

    const table = document.createElement("table");
    table.className = "fert-table";

    table.innerHTML = `
      <thead>
        <tr>
          <th>圃場</th>
          <th>施肥量（kg）</th>
          <th>袋数</th>
          <th>作業者</th>
          <th>メモ</th>
        </tr>
      </thead>
    `;

    const tbody = document.createElement("tbody");

    list.forEach(r => {
      const fieldLink = `
        <a href="https://d3sscxnlo0qnhe.cloudfront.net/fields/index.html?field=${encodeURIComponent(r.field)}"
           class="field-link">
          ${r.field}
        </a>
      `;

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${fieldLink}</td>
        <td class="value">${r.amount}</td>
        <td class="value">${r.bags !== null ? r.bags.toFixed(2) : "-"}</td>
        <td>${r.workers}</td>
        <td>${r.notes}</td>
      `;
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    details.appendChild(table);

    blocks.push(details);
  });

  return blocks;
}

/* ============================================================
   月全体の合計行（袋数対応）
============================================================ */
function createMonthlyTotal(blocks) {
  let totalKg = 0;
  let totalDays = 0;
  let totalBags = 0;

  blocks.forEach(b => {
    const summary = b.querySelector("summary").textContent;

    const kgMatch = summary.match(/\/\s*(\d+)kg/);
    if (kgMatch) totalKg += Number(kgMatch[1]);

    const bagMatch = summary.match(/\/\s*([\d.]+)袋/);
    if (bagMatch) totalBags += Number(bagMatch[1]);

    totalDays++;
  });

  const div = document.createElement("div");
  div.style.marginTop = "20px";

  const table = document.createElement("table");
  table.className = "fert-table";

  table.innerHTML = `
    <thead>
      <tr>
        <th>月合計日数</th>
        <th>月合計施肥量（kg）</th>
        <th>月合計袋数</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td class="value">${totalDays} 日</td>
        <td class="total">${totalKg}</td>
        <td class="total">${totalBags.toFixed(2)}</td>
      </tr>
    </tbody>
  `;

  div.appendChild(table);
  return div;
}

init();
