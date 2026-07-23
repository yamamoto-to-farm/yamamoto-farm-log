import { loadCSV } from "./csv.js";
import { loadJSON, saveJSON } from "./json.js";

export const MONTHLY_WORK_SOURCES = [
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
  },
  {
    key: "discard-seed",
    label: "播種破棄",
    kind: "csv",
    csv: "/logs/discard-seed/all.csv",
    dateFields: ["discardDate", "date", "workDate"],
    className: "tone-discard"
  }
];

const SUMMARY_PATH = "data/monthly-work-index.json";
let summaryCache = null;
let rebuildInFlight = null;

function createEmptySummary() {
  return {
    version: 1,
    months: {},
    lastUpdated: ""
  };
}

function toMonthKey(dateText) {
  const dateKey = toDateKey(dateText);
  return dateKey ? dateKey.slice(0, 7) : "";
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

function nowIso() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString();
}

function extractDateText(row, dateFields = []) {
  for (const field of dateFields) {
    const value = String(row?.[field] || "").trim();
    if (value) return value;
  }

  return String(row?.date || row?.workDate || row?.timestamp || row?.createdAt || "").trim();
}

function ensureMonth(summary, ym) {
  if (!summary.months[ym]) {
    summary.months[ym] = {
      total: 0,
      sources: {},
      days: {}
    };
  }

  return summary.months[ym];
}

function bump(summary, dateKey, sourceKey, count = 1) {
  if (!dateKey || !sourceKey || !count) return;

  const ym = dateKey.slice(0, 7);
  if (!ym) return;

  const month = ensureMonth(summary, ym);
  month.total += count;
  month.sources[sourceKey] = (month.sources[sourceKey] || 0) + count;

  if (!month.days[dateKey]) {
    month.days[dateKey] = {};
  }

  month.days[dateKey][sourceKey] = (month.days[dateKey][sourceKey] || 0) + count;
}

function bumpUniqueDay(summary, dateKey, sourceKey) {
  if (!dateKey || !sourceKey) return;

  const ym = dateKey.slice(0, 7);
  if (!ym) return;

  const month = ensureMonth(summary, ym);
  if (month.days[dateKey]?.[sourceKey]) return;

  bump(summary, dateKey, sourceKey, 1);
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

async function loadSourceRows(source) {
  try {
    if (source.kind === "json") {
      return await loadJsonTypeRows(source.type);
    }

    return await loadCSV(source.csv);
  } catch {
    return [];
  }
}

function normalizeSummary(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (!raw.months || typeof raw.months !== "object") return null;

  const summary = createEmptySummary();
  summary.lastUpdated = String(raw.lastUpdated || "");

  for (const [ym, month] of Object.entries(raw.months)) {
    if (!month || typeof month !== "object") continue;

    const nextMonth = ensureMonth(summary, ym);
    nextMonth.total = Number(month.total || 0);
    nextMonth.sources = { ...(month.sources || {}) };
    nextMonth.days = {};

    for (const [dateKey, sources] of Object.entries(month.days || {})) {
      nextMonth.days[dateKey] = { ...(sources || {}) };
    }
  }

  return summary;
}

function addRowsToSummary(summary, sourceKey, rows, dateFields) {
  for (const row of rows) {
    const dateKey = toDateKey(extractDateText(row, dateFields));
    if (sourceKey === "seed") {
      bumpUniqueDay(summary, dateKey, sourceKey);
      continue;
    }

    bump(summary, dateKey, sourceKey, 1);
  }
}

export async function rebuildMonthlyWorkSummary() {
  if (rebuildInFlight) return rebuildInFlight;

  rebuildInFlight = (async () => {
    const summary = createEmptySummary();

    for (const source of MONTHLY_WORK_SOURCES) {
      const rows = await loadSourceRows(source);
      addRowsToSummary(summary, source.key, rows, source.dateFields || []);
    }

    summary.lastUpdated = nowIso();
    summaryCache = summary;

    await saveJSON(SUMMARY_PATH, summary);
    return summary;
  })();

  try {
    return await rebuildInFlight;
  } finally {
    rebuildInFlight = null;
  }
}

export async function loadMonthlyWorkSummary({ rebuildIfMissing = true, forceRebuild = false } = {}) {
  if (!forceRebuild && summaryCache) return summaryCache;

  if (forceRebuild) {
    return await rebuildMonthlyWorkSummary();
  }

  const raw = await loadJSON(`/data/monthly-work-index.json`).catch(() => null);
  const normalized = normalizeSummary(raw);

  if (normalized) {
    summaryCache = normalized;
    return summaryCache;
  }

  if (!rebuildIfMissing) {
    summaryCache = createEmptySummary();
    return summaryCache;
  }

  return await rebuildMonthlyWorkSummary();
}

export async function recordMonthlyWorkEntries(entries) {
  const list = Array.isArray(entries) ? entries : [entries];
  const summary = await loadMonthlyWorkSummary({ rebuildIfMissing: true });

  for (const entry of list) {
    const dateKey = toDateKey(entry?.date);
    const sourceKey = String(entry?.sourceKey || "").trim();
    const count = Number(entry?.count || 1);

    if (!dateKey || !sourceKey || !count) continue;

    if (sourceKey === "seed") {
      bumpUniqueDay(summary, dateKey, sourceKey);
      continue;
    }

    bump(summary, dateKey, sourceKey, count);
  }

  summary.lastUpdated = nowIso();
  summaryCache = summary;

  await saveJSON(SUMMARY_PATH, summary);
  return summary;
}
