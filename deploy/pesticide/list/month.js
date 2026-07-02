import {
  loadAllPesticideLogs,
  getPesticideByName
} from "./list-utils.js?v=1";

function getParams() {
  const url = new URL(location.href);
  return {
    year: Number(url.searchParams.get("year")),
    month: Number(url.searchParams.get("month")),
    pesticide: url.searchParams.get("pesticide")
  };
}

async function init() {
  const { year, month, pesticide } = getParams();

  document.getElementById("page-title").textContent =
    `${year}年 ${month}月 「${pesticide}」 防除詳細`;

  const logs = await loadAllPesticideLogs();
  const pesticideInfo = await getPesticideByName(pesticide);
  const unit = pesticideInfo?.unit || "L";

  const container = document.getElementById("pesticide-detail-container");
  container.innerHTML = "";

  const result = createDateBlocks(logs, year, month, pesticide);
  result.blocks.forEach(b => container.appendChild(b));
  container.appendChild(createMonthlyTotal(result.rows, unit));
}

function createDateBlocks(logs, year, month, pesticideName) {
  const rows = [];

  logs.forEach(field => {
    if (field.year !== year) return;

    field.entries.forEach(e => {
      const m = Number(String(e.date || "").slice(5, 7));
      if (m !== month) return;
      if (!Array.isArray(e.distributed)) return;

      e.distributed.forEach(p => {
        if (p.name !== pesticideName) return;

        rows.push({
          field: field.field,
          date: e.date,
          spray_amount: Number(p.spray_amount || 0),
          dilution_rate: Number(p.dilution_rate || 0),
          unit: p.unit || "L",
          workers: e.workers || "",
          notes: e.notes || ""
        });
      });
    });
  });

  rows.sort((a, b) => (a.date > b.date ? 1 : -1));

  const groups = {};
  rows.forEach(r => {
    if (!groups[r.date]) groups[r.date] = [];
    groups[r.date].push(r);
  });

  const blocks = [];

  Object.keys(groups).forEach(date => {
    const list = groups[date];
    const totalSpray = list.reduce((a, b) => a + Number(b.spray_amount || 0), 0);
    const dilutionValues = Array.from(new Set(list.map(x => x.dilution_rate).filter(v => v > 0)));
    const dilutionText = dilutionValues.length ? `${dilutionValues.join(" / ")}倍` : "-";

    const details = document.createElement("details");
    details.className = "date-block";
    details.open = true;

    const summary = document.createElement("summary");
    const unit = list[0]?.unit || "L";
    summary.innerHTML = `${date}（${list.length}圃場 / ${formatNumber(totalSpray)}${unit} / ${dilutionText}）`;
    details.appendChild(summary);

    const table = document.createElement("table");
    table.className = "pest-table";

    table.innerHTML = `
      <thead>
        <tr>
          <th>圃場</th>
          <th>散布量</th>
          <th>倍率</th>
          <th>作業者</th>
          <th>メモ</th>
        </tr>
      </thead>
    `;

    const tbody = document.createElement("tbody");

    list.forEach(r => {
      const fieldLink = `
        <a href="/fields/index.html?field=${encodeURIComponent(r.field)}" class="field-link">
          ${escapeHtml(r.field)}
        </a>
      `;

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${fieldLink}</td>
        <td class="value">${formatNumber(r.spray_amount)} ${escapeHtml(r.unit || "L")}</td>
        <td class="value">${r.dilution_rate > 0 ? `${formatNumber(r.dilution_rate)}倍` : "-"}</td>
        <td>${escapeHtml(r.workers)}</td>
        <td>${escapeHtml(r.notes)}</td>
      `;
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    details.appendChild(table);
    blocks.push(details);
  });

  return { rows, blocks };
}

function createMonthlyTotal(rows, unit) {
  const dates = new Set(rows.map(r => r.date));
  const totalDays = dates.size;
  const totalSpray = rows.reduce((sum, r) => sum + Number(r.spray_amount || 0), 0);

  const div = document.createElement("div");
  div.style.marginTop = "20px";

  const table = document.createElement("table");
  table.className = "pest-table";

  table.innerHTML = `
    <thead>
      <tr>
        <th>月合計日数</th>
        <th>月合計散布量</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td class="value">${totalDays} 日</td>
        <td class="total">${formatNumber(totalSpray)} ${escapeHtml(unit)}</td>
      </tr>
    </tbody>
  `;

  div.appendChild(table);
  return div;
}

function formatNumber(value) {
  return Number(value || 0).toFixed(1).replace(/\.0$/, "");
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
