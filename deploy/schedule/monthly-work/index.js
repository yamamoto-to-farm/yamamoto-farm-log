import { verifyLocalAuth } from "/common/ui.js?v=1";
import { renderHeader } from "/common/header.js";
import { loadCSV } from "/common/csv.js";
import { loadJSON } from "/common/json.js";

const SOURCES = [
  {
    key: "seed",
    label: "播種",
    kind: "csv",
    csv: "/logs/seed/all.csv",
    dateFields: ["seedDate", "date", "workDate"],
    className: "pill-seed"
  },
  {
    key: "nursery",
    label: "育苗",
    kind: "csv",
    csv: "/logs/nursery/all.csv",
    dateFields: ["date", "nurseryDate", "workDate", "createdAt"],
    className: "pill-seed"
  },
  {
    key: "tillage",
    label: "耕起",
    kind: "json",
    type: "tillage",
    className: "pill-field"
  },
  {
    key: "weeding",
    label: "除草・草刈り",
    kind: "json",
    type: "weeding",
    className: "pill-field"
  },
  {
    key: "field-maintenance",
    label: "圃場整備",
    kind: "json",
    type: "field-maintenance",
    className: "pill-field"
  },
  {
    key: "pesticide",
    label: "防除",
    kind: "json",
    type: "pesticide",
    className: "pill-cultivation"
  },
  {
    key: "fertilizer",
    label: "施肥",
    kind: "json",
    type: "fertilizer",
    className: "pill-cultivation"
  },
  {
    key: "watering",
    label: "潅水",
    kind: "json",
    type: "watering",
    className: "pill-cultivation"
  },
  {
    key: "hand-weeding",
    label: "手作業除草",
    kind: "json",
    type: "hand-weeding",
    className: "pill-cultivation"
  },
  {
    key: "intertill",
    label: "中耕",
    kind: "json",
    type: "intertill",
    className: "pill-cultivation"
  },
  {
    key: "bedmaking",
    label: "畝立て",
    kind: "json",
    type: "bedmaking",
    className: "pill-cultivation"
  },
  {
    key: "planting",
    label: "定植",
    kind: "csv",
    csv: "/logs/planting/all.csv",
    dateFields: ["plantDate", "date", "workDate"],
    className: "pill-planting"
  },
  {
    key: "harvest",
    label: "収穫",
    kind: "csv",
    csv: "/logs/harvest/all.csv",
    dateFields: ["harvestDate", "date", "workDate"],
    className: "pill-harvest"
  },
  {
    key: "shipping",
    label: "出荷",
    kind: "csv",
    csv: "/logs/weight/all.csv",
    dateFields: ["shippingDate", "date", "workDate"],
    className: "pill-harvest"
  },
  {
    key: "discard-planting",
    label: "廃棄定植",
    kind: "csv",
    csv: "/logs/discard-planting/all.csv",
    dateFields: ["discardDate", "date", "workDate"],
    className: "pill-planting"
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

function toDateKey(dateText) {
  const text = String(dateText || "").trim();
  if (!text) return "";

  const isoMatch = text.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return "";

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatMonthLabel(ym) {
  const [year, month] = ym.split("-");
  return `${year}年${Number(month)}月`;
}

function formatDayLabel(dateKey) {
  const [, month, day] = dateKey.split("-");
  return `${Number(month)}/${Number(day)}`;
}

function getWeekdayLabel(index) {
  return ["日", "月", "火", "水", "木", "金", "土"][index] || "";
}

function extractDateText(row, dateFields = []) {
  for (const field of dateFields) {
    const value = String(row?.[field] || "").trim();
    if (value) return value;
  }

  return String(row?.date || row?.workDate || row?.timestamp || row?.createdAt || "").trim();
}

function buildSourceStats(rows, dateFields) {
  const monthCounts = new Map();
  const dayBuckets = new Map();

  for (const row of rows) {
    const dateKey = toDateKey(extractDateText(row, dateFields));
    const ym = dateKey.slice(0, 7);
    if (!ym) continue;

    monthCounts.set(ym, (monthCounts.get(ym) || 0) + 1);

    if (!dayBuckets.has(ym)) {
      dayBuckets.set(ym, new Map());
    }

    const days = dayBuckets.get(ym);
    days.set(dateKey, (days.get(dateKey) || 0) + 1);
  }

  return { monthCounts, dayBuckets };
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

async function loadJsonTypeRows(type) {
  const index = await loadTypeIndex(type);
  const rows = [];

  for (const field of Object.keys(index)) {
    const log = await loadJSON(`/logs/${type}/${field}.json`).catch(() => ({}));
    const years = log?.years || {};

    for (const year of Object.keys(years)) {
      const entries = years[year]?.entries;
      if (!Array.isArray(entries)) continue;

      for (const entry of entries) {
        if (entry && typeof entry === "object") rows.push(entry);
      }
    }
  }

  return rows;
}

async function loadTypeIndex(type) {
  const paths = [
    `/data/${type}/${type}-index.json`,
    `/data/${type}-index.json`
  ];

  for (const path of paths) {
    const data = await loadJSON(path).catch(() => ({}));
    if (data && typeof data === "object" && Object.keys(data).length > 0) {
      return data;
    }
  }

  return {};
}

function buildCalendarDays(ym) {
  const [yearText, monthText] = ym.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const firstDate = new Date(year, monthIndex, 1);
  const firstWeekday = firstDate.getDay();
  const lastDate = new Date(year, monthIndex + 1, 0);
  const daysInMonth = lastDate.getDate();
  const cells = [];

  for (let i = 0; i < firstWeekday; i += 1) {
    cells.push(null);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateKey = `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    cells.push({ dateKey, day, weekday: new Date(year, monthIndex, day).getDay() });
  }

  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  return cells;
}

function renderMonthCard(ym, sourceCounts, isOpen) {
  const totals = sourceCounts.map(({ label, className, monthCounts }) => ({
    label,
    className,
    count: monthCounts.get(ym) || 0
  }));

  const totalCount = totals.reduce((sum, item) => sum + item.count, 0);
  const dayMap = new Map();

  for (const source of sourceCounts) {
    const days = source.dayBuckets.get(ym);
    if (!days) continue;

    for (const [dateKey, count] of days.entries()) {
      if (!dayMap.has(dateKey)) {
        dayMap.set(dateKey, []);
      }

      dayMap.get(dateKey).push({
        label: source.label,
        className: source.className,
        count
      });
    }
  }

  const calendarCells = buildCalendarDays(ym);

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

      <div class="calendar-wrap">
        <div class="calendar-weekdays">
          ${["日", "月", "火", "水", "木", "金", "土"].map(label => `<div class="weekday">${label}</div>`).join("")}
        </div>

        <div class="calendar-grid">
          ${calendarCells.map(cell => {
            if (!cell) return '<div class="calendar-cell is-empty"></div>';

            const daySources = dayMap.get(cell.dateKey) || [];
            const href = `/diary/index.html?date=${cell.dateKey}`;
            const dots = daySources
              .sort((a, b) => a.label.localeCompare(b.label, "ja"))
              .map(source => `<span class="day-dot ${source.className}" title="${cell.dateKey} ${source.label} ${countLabel(source.count)}"></span>`)
              .join("");

            return `
              <a class="calendar-cell ${daySources.length ? "has-work" : ""}" href="${href}" title="${cell.dateKey} の作業日誌を開く">
                <span class="day-number">${cell.day}</span>
                <span class="day-dots">${dots}</span>
              </a>
            `;
          }).join("")}
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
      rows: source.kind === "json"
        ? await loadJsonTypeRows(source.type)
        : await loadCSV(source.csv).catch(() => [])
    }))
  );

  const sourceCounts = sourceRows.map(source => ({
    label: source.label,
    className: source.className,
    ...buildSourceStats(source.rows, source.dateFields)
  }));

  const monthSet = new Set();
  for (const source of sourceCounts) {
    for (const ym of source.monthCounts.keys()) {
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