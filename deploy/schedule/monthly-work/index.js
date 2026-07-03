import { verifyLocalAuth } from "/common/ui.js?v=1";
import { renderHeader } from "/common/header.js";
import { loadCSV } from "/common/csv.js";

const SOURCES = [
  {
    key: "seed",
    label: "播種",
    csv: "/logs/seed/all.csv",
    dateField: "seedDate",
    className: "pill-seed"
  },
  {
    key: "planting",
    label: "定植",
    csv: "/logs/planting/all.csv",
    dateField: "plantDate",
    className: "pill-planting"
  },
  {
    key: "harvest",
    label: "収穫",
    csv: "/logs/harvest/all.csv",
    dateField: "harvestDate",
    className: "pill-harvest"
  },
  {
    key: "shipping",
    label: "出荷",
    csv: "/logs/weight/all.csv",
    dateField: "shippingDate",
    className: "pill-shipping"
  },
  {
    key: "discard-planting",
    label: "廃棄定植",
    csv: "/logs/discard-planting/all.csv",
    dateField: "discardDate",
    className: "pill-discard"
  }
]

function toMonthKey(dateText) {
  if (!dateText) return "";
  const date = new Date(dateText);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function formatMonthLabel(ym) {
  const [year, month] = ym.split("-");
  return `${year}年${Number(month)}月`;
}

function buildCounts(rows, dateField) {
  const counts = new Map();

  for (const row of rows) {
    const ym = toMonthKey(row[dateField]);
    if (!ym) continue;
    counts.set(ym, (counts.get(ym) || 0) + 1);
  }

  return counts;
}

function countLabel(count) {
  return `${count}件`;
}

function getCurrentMonthKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function renderMonthCard(ym, sourceCounts, isOpen) {
  const totals = sourceCounts.map(({ label, className, counts }) => ({
    label,
    className,
    count: counts.get(ym) || 0
  }));

  const totalCount = totals.reduce((sum, item) => sum + item.count, 0);

  return `
    <details class="month-card" ${isOpen ? "open" : ""}>
      <summary class="month-head">
        <h3 class="month-title">
          <span>${formatMonthLabel(ym)}</span>
          <span class="month-total">合計 ${countLabel(totalCount)}</span>
        </h3>
        <div class="month-meta">
          ${totals.map(item => `<span class="pill ${item.className}">${item.label} ${countLabel(item.count)}</span>`).join("")}
        </div>
      </summary>

      <div style="margin-top:14px;">
        <div class="summary-grid">
          ${totals.map(item => `
            <div class="summary-chip">
              <div class="label">${item.label}</div>
              <div class="value">${item.count}</div>
            </div>
          `).join("")}
        </div>
      </div>
    </details>
  `;
}

async function main() {
  const ok = await verifyLocalAuth();
  if (!ok) return;

  renderHeader();

  if (window.currentRole === "worker") {
    alert("このページは家族または管理者のみ閲覧できます");
    location.href = "/";
    return;
  }

  document.getElementById("page-area").style.display = "block";

  const sourceRows = await Promise.all(
    SOURCES.map(async source => ({
      ...source,
      rows: await loadCSV(source.csv)
    }))
  );

  const sourceCounts = sourceRows.map(source => ({
    label: source.label,
    className: source.className,
    counts: buildCounts(source.rows, source.dateField)
  }));

  const monthSet = new Set();
  for (const source of sourceCounts) {
    for (const ym of source.counts.keys()) {
      monthSet.add(ym);
    }
  }

  const months = [...monthSet].sort((a, b) => b.localeCompare(a, "ja"));
  const monthList = document.getElementById("month-list");

  if (months.length === 0) {
    monthList.innerHTML = '<div class="empty-state">記録がまだありません。</div>';
    return;
  }

  const currentYm = getCurrentMonthKey();
  monthList.innerHTML = months.map(ym => renderMonthCard(ym, sourceCounts, ym === currentYm || ym === months[0])).join("");
}

main();