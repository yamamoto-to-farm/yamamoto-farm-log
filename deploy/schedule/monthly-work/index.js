import { verifyLocalAuth } from "/common/ui.js?v=1";
import { renderHeader } from "/common/header.js";
import { loadCSV } from "/common/csv.js";
import { loadJSON } from "/common/json.js";
import { loadMonthlyWorkSummary } from "/common/monthly-work-summary.js?v=1";

const SOURCES = [
  {
    key: "seed",
    label: "播種",
    kind: "csv",
    csv: "/logs/seed/all.csv",
    dateFields: ["seedDate", "date", "workDate"],
    className: "tone-start"
  },
  {
    key: "nursery",
    label: "育苗",
    kind: "csv",
    csv: "/logs/nursery/all.csv",
    dateFields: ["date", "nurseryDate", "workDate", "createdAt"],
    className: "tone-start"
  },
  {
    key: "tillage",
    label: "耕起",
    kind: "json",
    type: "tillage",
    className: "tone-field"
  },
  {
    key: "weeding",
    label: "除草・草刈り",
    kind: "json",
    type: "weeding",
    className: "tone-care"
  },
  {
    key: "field-maintenance",
    label: "圃場整備",
    kind: "json",
    type: "field-maintenance",
    className: "tone-field"
  },
  {
    key: "pesticide",
    label: "防除",
    kind: "json",
    type: "pesticide",
    className: "tone-care"
  },
  {
    key: "fertilizer",
    label: "施肥",
    kind: "json",
    type: "fertilizer",
    className: "tone-care"
  },
  {
    key: "watering",
    label: "潅水",
    kind: "json",
    type: "watering",
    className: "tone-care"
  },
  {
    key: "hand-weeding",
    label: "手作業除草",
    kind: "json",
    type: "hand-weeding",
    className: "tone-care"
  },
  {
    key: "intertill",
    label: "中耕",
    kind: "json",
    type: "intertill",
    className: "tone-field"
  },
  {
    key: "bedmaking",
    label: "畝立て",
    kind: "json",
    type: "bedmaking",
    className: "tone-field"
  },
  {
    key: "planting",
    label: "定植",
    kind: "csv",
    csv: "/logs/planting/all.csv",
    dateFields: ["plantDate", "date", "workDate"],
    className: "tone-start"
  },
  {
    key: "harvest",
    label: "収穫",
    kind: "csv",
    csv: "/logs/harvest/all.csv",
    dateFields: ["harvestDate", "date", "workDate"],
    className: "tone-harvest"
  },
  {
    key: "discard-planting",
    label: "廃棄定植",
    kind: "csv",
    csv: "/logs/discard-planting/all.csv",
    dateFields: ["discardDate", "date", "workDate"],
    className: "tone-discard"
  }
]

const SOURCE_LOOKUP = Object.fromEntries(SOURCES.map(source => [source.key, source]));
const SOURCE_KEYS = SOURCES.map(source => source.key);

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

function addMonths(ym, offset) {
  const [yearText, monthText] = ym.split("-");
  const date = new Date(Number(yearText), Number(monthText) - 1 + offset, 1);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function getFilterState() {
  const params = new URLSearchParams(location.search);
  const rawTypes = (params.get("types") || "").trim();
  const selectedSourceKeys = rawTypes
    ? rawTypes.split(",").map(v => v.trim()).filter(v => SOURCE_LOOKUP[v])
    : [...SOURCE_KEYS];

  return {
    mode: params.get("mode") || "latest4",
    referenceYm: params.get("ym") || "",
    selectedSourceKeys
  };
}

function normalizeSelectedSourceKeys(keys) {
  const set = new Set(Array.isArray(keys) ? keys : []);
  return SOURCE_KEYS.filter(key => set.has(key));
}

function setFilterState(mode, referenceYm, selectedSourceKeys) {
  const params = new URLSearchParams(location.search);
  params.set("mode", mode);
  if (referenceYm) {
    params.set("ym", referenceYm);
  } else {
    params.delete("ym");
  }

  const normalized = normalizeSelectedSourceKeys(selectedSourceKeys);
  params.set("types", normalized.join(","));

  const nextUrl = `${location.pathname}?${params.toString()}`;
  history.replaceState(null, "", nextUrl);
}

function buildSourceTotalCounts(monthDataMap) {
  const totals = Object.fromEntries(SOURCE_KEYS.map(key => [key, 0]));

  for (const month of Object.values(monthDataMap || {})) {
    for (const key of SOURCE_KEYS) {
      totals[key] += Number(month?.sources?.[key] || 0);
    }
  }

  return totals;
}

function renderSourceFilterChips(selectedSourceKeys, sourceTotalCounts) {
  const area = document.getElementById("source-filter-chips");
  if (!area) return;

  const selectedSet = new Set(normalizeSelectedSourceKeys(selectedSourceKeys));
  area.innerHTML = SOURCES.map(source => {
    const on = selectedSet.has(source.key);
    const total = Number(sourceTotalCounts?.[source.key] || 0);
    return `
      <button
        type="button"
        class="source-chip ${source.className} ${on ? "" : "off"}"
        data-source-key="${source.key}"
        aria-pressed="${on ? "true" : "false"}">
        ${source.label} ${countLabel(total)}
      </button>
    `;
  }).join("");
}

function getCurrentMonthKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function getInitialMonthKey() {
  const params = new URLSearchParams(location.search);
  const ym = params.get("ym");
  if (ym && /^\d{4}-\d{2}$/.test(ym)) return ym;

  const date = params.get("date");
  const dateKey = toDateKey(date);
  if (dateKey) return dateKey.slice(0, 7);

  return getCurrentMonthKey();
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

function getVisibleMonths(allMonths, mode, referenceYm) {
  const available = new Set(allMonths);

  if (mode === "latest4") {
    return allMonths.slice(0, 4);
  }

  const baseYm = referenceYm && available.has(referenceYm)
    ? referenceYm
    : allMonths[0] || "";

  if (!baseYm) return [];

  if (mode === "sameMonth") {
    const monthNo = baseYm.slice(5, 7);
    return allMonths.filter(ym => ym.slice(5, 7) === monthNo);
  }

  const radius = 2;
  const months = [];

  for (let offset = -radius; offset <= radius; offset += 1) {
    const ym = addMonths(baseYm, offset);
    if (available.has(ym)) months.push(ym);
  }

  months.sort((a, b) => b.localeCompare(a, "ja"));
  return months;
}

function renderMonthOptions(months, referenceYm) {
  const select = document.getElementById("reference-month");
  if (!select) return;

  select.innerHTML = months.map(ym => {
    const selected = ym === referenceYm ? " selected" : "";
    return `<option value="${ym}"${selected}>${formatMonthLabel(ym)}</option>`;
  }).join("");
}

function renderVisibleMonths(months, monthDataMap, mode, referenceYm, selectedSourceKeys) {
  const visibleMonths = getVisibleMonths(months, mode, referenceYm);
  const monthList = document.getElementById("month-list");
  const filterNote = document.getElementById("filter-note");
  const selectedCount = normalizeSelectedSourceKeys(selectedSourceKeys).length;

  if (filterNote) {
    const label = mode === "latest4"
      ? "直近4か月を表示しています。"
      : mode === "sameMonth"
        ? `${referenceYm ? formatMonthLabel(referenceYm) : "指定月"} と同じ月のカードを、データがある年だけ表示しています。`
        : `${referenceYm ? formatMonthLabel(referenceYm) : "指定月"} の前後2か月を表示しています。`;
    filterNote.textContent = `${label} 現在 ${selectedCount} 作業を表示中です。月数を絞ると、表示カードとカレンダー描画が軽くなります。`;
  }

  if (visibleMonths.length === 0) {
    monthList.innerHTML = '<div class="empty-state">表示できる記録がまだありません。</div>';
    return;
  }

  const openYm = visibleMonths.includes(referenceYm) ? referenceYm : visibleMonths[0];
  monthList.innerHTML = visibleMonths
    .map(ym => renderMonthCard(ym, monthDataMap[ym] || {}, ym === openYm, selectedSourceKeys))
    .join("");
}

function renderMonthCard(ym, monthData, isOpen, selectedSourceKeys) {
  const selectedSet = new Set(normalizeSelectedSourceKeys(selectedSourceKeys));
  const totals = SOURCES.map(({ key, label, className }) => ({
    key,
    label,
    className,
    rawCount: Number(monthData.sources?.[key] || 0),
    count: selectedSet.has(key) ? Number(monthData.sources?.[key] || 0) : 0,
    on: selectedSet.has(key)
  }));

  const totalCount = totals.reduce((sum, item) => sum + item.count, 0);
  const dayMap = monthData.days || {};

  const calendarCells = buildCalendarDays(ym);

  return `
    <details class="month-card" ${isOpen ? "open" : ""}>
      <summary class="month-head">
        <h3 class="month-title">
          <span>${formatMonthLabel(ym)}</span>
          <span class="month-total">合計 ${countLabel(totalCount)}</span>
        </h3>
        <div class="month-meta">
          ${totals.map(item => `<span class="pill ${item.className} ${item.on ? "" : "off"}">${item.label} ${countLabel(item.count)}</span>`).join("")}
        </div>
      </summary>

      <div class="calendar-wrap">
        <div class="calendar-weekdays">
          ${["日", "月", "火", "水", "木", "金", "土"].map(label => `<div class="weekday">${label}</div>`).join("")}
        </div>

        <div class="calendar-grid">
          ${calendarCells.map(cell => {
            if (!cell) return '<div class="calendar-cell is-empty"></div>';

            const daySources = dayMap[cell.dateKey] || {};
            const href = `/diary/index.html?date=${cell.dateKey}`;
            const filteredEntries = Object.entries(daySources).filter(([sourceKey]) => selectedSet.has(sourceKey));
            const dots = filteredEntries
              .sort((a, b) => {
                const aInfo = SOURCE_LOOKUP[a[0]] || { label: a[0] };
                const bInfo = SOURCE_LOOKUP[b[0]] || { label: b[0] };
                return aInfo.label.localeCompare(bInfo.label, "ja");
              })
              .map(([sourceKey, count]) => {
                const source = SOURCE_LOOKUP[sourceKey];
                const className = source?.className || "";
                const label = source?.label || sourceKey;
                return `<span class="day-dot ${className}" title="${cell.dateKey} ${label} ${countLabel(count)}"></span>`;
              })
              .join("");

            return `
              <a class="calendar-cell ${filteredEntries.length ? "has-work" : ""}" href="${href}" title="${cell.dateKey} の作業日誌を開く">
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
  const monthList = document.getElementById("month-list");
  const monthMode = document.getElementById("month-mode");
  const referenceMonth = document.getElementById("reference-month");

  const summary = await loadMonthlyWorkSummary({ rebuildIfMissing: true });
  const months = Object.keys(summary.months || {}).sort((a, b) => b.localeCompare(a, "ja"));

  if (months.length === 0) {
    monthList.innerHTML = '<div class="empty-state">記録がまだありません。</div>';
    return;
  }

  const initialReferenceYm = getInitialMonthKey();
  const initialFilter = getFilterState();
  const defaultReferenceYm = months.includes(initialReferenceYm) ? initialReferenceYm : months[0];
  const supportedModes = new Set(["latest4", "around2", "sameMonth"]);
  const initialMode = supportedModes.has(initialFilter.mode) ? initialFilter.mode : "latest4";
  const sourceTotalCounts = buildSourceTotalCounts(summary.months);
  let selectedSourceKeys = normalizeSelectedSourceKeys(initialFilter.selectedSourceKeys);

  renderMonthOptions(months, defaultReferenceYm);
  renderSourceFilterChips(selectedSourceKeys, sourceTotalCounts);

  const applyFilter = () => {
    const mode = monthMode.value;
    const ym = referenceMonth.value || defaultReferenceYm;
    setFilterState(mode, ym, selectedSourceKeys);
    renderVisibleMonths(months, summary.months, mode, ym, selectedSourceKeys);
  };

  monthMode.value = initialMode;
  referenceMonth.value = defaultReferenceYm;

  monthMode.addEventListener("change", applyFilter);
  referenceMonth.addEventListener("change", applyFilter);

  const sourceFilterArea = document.getElementById("source-filter-chips");
  if (sourceFilterArea) {
    sourceFilterArea.addEventListener("click", event => {
      const btn = event.target.closest("[data-source-key]");
      if (!btn) return;

      const key = btn.getAttribute("data-source-key");
      if (!key || !SOURCE_LOOKUP[key]) return;

      const set = new Set(selectedSourceKeys);
      if (set.has(key)) {
        set.delete(key);
      } else {
        set.add(key);
      }

      selectedSourceKeys = normalizeSelectedSourceKeys([...set]);
      renderSourceFilterChips(selectedSourceKeys, sourceTotalCounts);
      applyFilter();
    });
  }

  renderVisibleMonths(months, summary.months, monthMode.value, referenceMonth.value, selectedSourceKeys);
}

main();