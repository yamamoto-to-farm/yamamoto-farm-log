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

  const result = createDateBlocks(logs, year, month, fert, fertInfo);
  result.blocks.forEach(b => container.appendChild(b));

  container.appendChild(createMonthlyTotal(result.rows, fertInfo));
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
          workers: formatWorkers(e.workers),
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

    const totalKg = list.reduce((a, b) => a + Number(b.amount || 0), 0);
    const totalBags = fertInfo?.capacity
      ? list.reduce((a, b) => a + Number(b.bags || 0), 0)
      : null;

    const details = document.createElement("details");
    details.className = "date-block";
    details.open = true;

    const summary = document.createElement("summary");
    summary.innerHTML = `${escapeHtml(date)}`;
    details.appendChild(summary);

    const dailyTotals = document.createElement("div");
    dailyTotals.className = "daily-totals";
    dailyTotals.innerHTML = `
      <span class="daily-totals-item">圃場 ${list.length}</span>
      <span class="daily-totals-item">合計 ${formatAmount(totalKg)}kg</span>
      ${totalBags !== null
        ? `<span class="daily-totals-item">${formatBags(totalBags)}袋</span>`
        : ""}
    `;
    details.appendChild(dailyTotals);

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
      const q = new URLSearchParams({
        field: String(r.field || ""),
        start: String(r.date || ""),
        end: String(r.date || ""),
        type: "fertilizer"
      });

      const fieldLink = `
        <a href="/fields/work-logs.html?${q.toString()}"
           class="field-link">
          ${escapeHtml(r.field)}
        </a>
      `;

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${fieldLink}</td>
        <td class="value">${formatAmount(r.amount)}</td>
        <td class="value">${r.bags !== null ? formatBags(r.bags) : "-"}</td>
        <td>${escapeHtml(r.workers)}</td>
        <td class="memo-cell" title="${escapeHtml(r.notes)}">${escapeHtml(r.notes)}</td>
      `;
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    details.appendChild(table);

    blocks.push(details);
  });

  return { blocks, rows };
}

/* ============================================================
   月全体の合計行（袋数対応）
============================================================ */
function createMonthlyTotal(rows, fertInfo) {
  const dates = new Set(rows.map(r => r.date).filter(Boolean));
  const totalDays = dates.size;
  const totalKg = rows.reduce((sum, r) => sum + Number(r.amount || 0), 0);
  const hasBag = Boolean(fertInfo?.capacity);
  const totalBags = hasBag
    ? rows.reduce((sum, r) => sum + Number(r.bags || 0), 0)
    : null;

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
        <td class="total">${formatAmount(totalKg)}</td>
        <td class="total">${hasBag ? formatBags(totalBags) : "-"}</td>
      </tr>
    </tbody>
  `;

  div.appendChild(table);
  return div;
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

function formatBags(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return "0.00";
  return n.toLocaleString("ja-JP", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatWorkers(workers) {
  if (Array.isArray(workers)) {
    return workers
      .map(v => String(v || "").trim())
      .filter(Boolean)
      .join("／");
  }

  if (workers && typeof workers === "object") {
    return Object.values(workers)
      .map(v => String(v || "").trim())
      .filter(Boolean)
      .join("／");
  }

  return String(workers || "").trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

init();
