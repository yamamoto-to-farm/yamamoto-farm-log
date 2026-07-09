import { loadCSV } from "./csv.js";
import { saveLog } from "./save/index.js";

const TIMESTAMP_PATH = "/logs/timestamp/all.csv";
const TIMESTAMP_HEADERS = [
  "date",
  "folder",
  "workType",
  "field",
  "workers",
  "machine",
  "time",
  "savedAt",
  "sessionKey",
  "workKey"
];

let timestampCache = null;

function normalizeText(value) {
  return String(value ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/,/g, "／")
    .trim();
}

function normalizeDate(value) {
  const text = normalizeText(value);
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const slash = text.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (slash) {
    const mm = String(Number(slash[2])).padStart(2, "0");
    const dd = String(Number(slash[3])).padStart(2, "0");
    return `${slash[1]}-${mm}-${dd}`;
  }

  return text;
}

function normalizeTime(value) {
  const text = normalizeText(value);
  const match = text.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return "";
  const hh = String(Number(match[1])).padStart(2, "0");
  const mm = String(Number(match[2])).padStart(2, "0");
  return `${hh}:${mm}`;
}

function nowTimeText() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function nowSavedAtText() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

export function createSessionKey() {
  return (crypto?.randomUUID?.() || `sess-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

export function buildTimestampKey({
  date,
  folder,
  workType,
  field,
  workers,
  machine
}) {
  return [
    normalizeDate(date),
    normalizeText(folder),
    normalizeText(workType),
    normalizeText(field),
    normalizeText(workers),
    normalizeText(machine)
  ].join("#").toLowerCase();
}

export function createTimestampRecord({
  date,
  folder,
  workType,
  field,
  workers,
  machine,
  time,
  savedAt,
  sessionKey
}) {
  const normalizedDate = normalizeDate(date);
  const normalizedTime = normalizeTime(time) || nowTimeText();
  const normalizedSavedAt = normalizeText(savedAt) || nowSavedAtText();
  const normalizedFolder = normalizeText(folder);
  const normalizedWorkType = normalizeText(workType || folder);
  const normalizedField = normalizeText(field);
  const normalizedWorkers = normalizeText(workers);
  const normalizedMachine = normalizeText(machine);
  const normalizedSessionKey = normalizeText(sessionKey) || createSessionKey();

  return {
    date: normalizedDate,
    folder: normalizedFolder,
    workType: normalizedWorkType,
    field: normalizedField,
    workers: normalizedWorkers,
    machine: normalizedMachine,
    time: normalizedTime,
    savedAt: normalizedSavedAt,
    sessionKey: normalizedSessionKey,
    workKey: buildTimestampKey({
      date: normalizedDate,
      folder: normalizedFolder,
      workType: normalizedWorkType,
      field: normalizedField,
      workers: normalizedWorkers,
      machine: normalizedMachine
    })
  };
}

function buildTimestampCsv(rows) {
  const body = rows
    .map(row => TIMESTAMP_HEADERS.map(key => normalizeText(row?.[key])).join(","))
    .join("\n");

  return [TIMESTAMP_HEADERS.join(","), body].filter(Boolean).join("\n") + "\n";
}

export async function loadTimestampRows(date = "") {
  if (timestampCache) {
    const cachedRows = timestampCache.map(row => ({ ...row }));
    if (date) {
      const target = normalizeDate(date);
      return cachedRows.filter(row => row.date === target);
    }
    return cachedRows;
  }

  try {
    const rows = await loadCSV(TIMESTAMP_PATH);
    const normalized = rows.map(row => ({
      date: normalizeDate(row?.date),
      folder: normalizeText(row?.folder),
      workType: normalizeText(row?.workType),
      field: normalizeText(row?.field),
      workers: normalizeText(row?.workers),
      machine: normalizeText(row?.machine),
      time: normalizeTime(row?.time),
      savedAt: normalizeText(row?.savedAt),
      sessionKey: normalizeText(row?.sessionKey),
      workKey: normalizeText(row?.workKey)
    })).filter(row => row.date && row.time && row.workKey);

    timestampCache = normalized.map(row => ({ ...row }));

    if (date) {
      const target = normalizeDate(date);
      return normalized.filter(row => row.date === target);
    }

    return normalized;
  } catch {
    return [];
  }
}

export async function saveTimestampRows(records) {
  const batchSessionKey = createSessionKey();
  const incoming = (Array.isArray(records) ? records : [])
    .map(record => createTimestampRecord({
      ...record,
      sessionKey: record?.sessionKey || batchSessionKey
    }))
    .filter(row => row.date && row.time && row.workKey);

  if (!incoming.length) return;

  const existing = await loadTimestampRows();
  const rows = [...existing, ...incoming];

  timestampCache = rows.map(row => ({ ...row }));

  await saveLog({
    type: "timestamp",
    replaceCsv: buildTimestampCsv(rows),
    fileName: "all.csv",
    suppressModal: true
  });
}

export function buildTimestampDefaults(autoList, timestampRows) {
  const groupedAutoIndexes = new Map();
  const groupedTimestampRows = new Map();

  autoList.forEach((item, index) => {
    const key = normalizeText(item?.sessionKey || item?.timestampKey || item?.groupKey || item?.sourceKey || "").toLowerCase();
    if (!key) return;
    if (!groupedAutoIndexes.has(key)) groupedAutoIndexes.set(key, []);
    groupedAutoIndexes.get(key).push(index);
  });

  (Array.isArray(timestampRows) ? timestampRows : []).forEach((row, index) => {
    const key = normalizeText(row?.sessionKey || row?.workKey || "").toLowerCase();
    if (!key) return;
    if (!groupedTimestampRows.has(key)) groupedTimestampRows.set(key, []);
    groupedTimestampRows.get(key).push({
      ...row,
      __index: index
    });
  });

  const defaults = autoList.map(() => ({ start: "", end: "" }));

  for (const [key, indexes] of groupedAutoIndexes.entries()) {
    const rows = (groupedTimestampRows.get(key) || []).slice().sort((a, b) => {
      const timeDiff = String(a.time || "").localeCompare(String(b.time || ""));
      if (timeDiff !== 0) return timeDiff;
      return a.__index - b.__index;
    });

    rows.forEach((row, pos) => {
      const targetIndex = indexes[pos];
      if (targetIndex === undefined) return;

      const targetItem = autoList[targetIndex] || {};
      const isMergedGroup = Array.isArray(targetItem.items) && targetItem.items.length > 1;

      defaults[targetIndex] = {
        start: isMergedGroup ? "" : (pos > 0 ? rows[pos - 1].time || "" : ""),
        end: isMergedGroup ? (rows[rows.length - 1]?.time || row.time || "") : (row.time || "")
      };
    });
  }

  return defaults;
}
