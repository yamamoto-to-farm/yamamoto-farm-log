// =========================================================
// diary/work-summary.js — list.json + headerName 対応版（field 抽出対応）
// =========================================================

import { loadCSV, normalizeKeys } from "/common/csv.js";
import { buildTimestampKey } from "/common/timestamp.js?v=1";

let searchIndexCache = null;
let folderListCache = null;
const csvRowsCache = new Map();
const folderDateBucketCache = new Map();

function resetWorkSummaryCaches() {
  searchIndexCache = null;
  folderListCache = null;
  csvRowsCache.clear();
  folderDateBucketCache.clear();
}

// list.json を読み込む
async function loadFolderList() {
  if (folderListCache) return folderListCache;

  const res = await fetch("/diary/list.json");
  if (!res.ok) {
    console.error("list.json が読み込めませんでした");
    folderListCache = [];
    return folderListCache;
  }

  folderListCache = await res.json();
  return folderListCache;
}

// CSV 読み込み（404 は null を返す）
async function loadLogCsv(folder) {
  if (csvRowsCache.has(folder)) {
    return csvRowsCache.get(folder);
  }

  try {
    const rows = await loadCSV(`/logs/${folder}/all.csv`);
    const normalized = normalizeKeys(rows);
    csvRowsCache.set(folder, normalized);
    return normalized;
  } catch (e) {
    console.warn(`[work-summary] all.csv が見つかりません: ${folder}`);
    csvRowsCache.set(folder, null);
    return null; // ← 存在しないフォルダは読み飛ばす
  }
}

function getRowsByDate(folder, dateColumn, csvRows, targetDate) {
  const cacheKey = `${folder}::${dateColumn}`;

  if (!folderDateBucketCache.has(cacheKey)) {
    const bucket = new Map();
    (Array.isArray(csvRows) ? csvRows : []).forEach(row => {
      const date = String(row?.[dateColumn] || "").trim();
      if (!date) return;

      const list = bucket.get(date) || [];
      list.push(row);
      bucket.set(date, list);
    });

    folderDateBucketCache.set(cacheKey, bucket);
  }

  const bucket = folderDateBucketCache.get(cacheKey);
  return bucket?.get(targetDate) || [];
}

async function buildSearchIndex() {
  const folderList = await loadFolderList();
  const rows = [];

  for (const item of folderList) {
    const { folder, dateColumn, displayName, headerName } = item;
    const csvRows = await loadLogCsv(folder);
    if (!csvRows) continue;

    csvRows.forEach((data, idx) => {
      rows.push({
        id: `${folder}-${idx}`,
        folder,
        dateColumn,
        displayName,
        headerName,
        data,
        date: String(data?.[dateColumn] || "").trim(),
        worker: extractWorkerText(data),
        field: String(data?.field || "").trim(),
        machine: String(data?.machine || "").trim(),
        snippet: buildSnippet(headerName, dateColumn, data),
        searchText: buildSearchText(displayName, headerName, data)
      });
    });
  }

  rows.sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return a.displayName.localeCompare(b.displayName, "ja");
  });

  return rows;
}

async function loadSearchIndex() {
  if (!searchIndexCache) {
    searchIndexCache = await buildSearchIndex();
  }
  return searchIndexCache;
}

// 日付一致のログを集約
export async function loadLogsByDate(date) {
  const folderList = await loadFolderList();
  const result = [];

  for (const item of folderList) {
    const { folder, dateColumn, displayName, headerName } = item;

    const rows = await loadLogCsv(folder);
    if (!rows) continue; // all.csv が無いフォルダは除外

    getRowsByDate(folder, dateColumn, rows, date).forEach(r => {
      result.push({
        folder,
        dateColumn,
        displayName,
        headerName,
        data: r
      });
    });
  }

  return result;
}

export function clearWorkSummaryCache() {
  resetWorkSummaryCaches();
}

// UI 表示
export async function showWorkSummary(date, preloadedLogs = null) {
  const box = document.getElementById("workList");
  const logs = Array.isArray(preloadedLogs) ? preloadedLogs : await loadLogsByDate(date);

  if (logs.length === 0) {
    box.innerHTML = "<p>この日の作業ログはありません。</p>";
    return;
  }

  box.innerHTML = logs.map(log => {
    const cols = log.headerName.map(col => log.data[col] ?? "");
    return `
      <div class="work-item">
        <p><strong>${log.displayName}</strong></p>
        <p>${cols.join(" / ")}</p>
      </div>
    `;
  }).join("");
}

export async function searchLogsByKeyword(keyword, options = {}) {
  const query = normalizeToken(keyword);
  const limit = Number(options?.limit || 80);
  if (!query) {
    return {
      query: "",
      total: 0,
      hits: []
    };
  }

  const rows = await loadSearchIndex();
  const filtered = rows.filter(row => row.searchText.includes(query));

  return {
    query,
    total: filtered.length,
    hits: filtered.slice(0, Math.max(1, limit))
  };
}

// =========================================================
// 作業編集カード用：作業名＋従事者＋圃場ID＋機械の自動抽出
// =========================================================

export function extractWorkForEdit(logs, timestampRows = []) {
  const autoList = [];
  const timestampMap = buildTimestampMap(timestampRows);

  logs.forEach((log, logIndex) => {
    const displayName = String(log.displayName || "").trim();
    const rowWorkType = String(log.folder === "seed" ? (log.data?.source || "") : (log.data?.workType || "")).trim();
    const sourceTypeKey = String(log.folder === "seed" ? (log.data?.source || log.displayName || "") : (log.data?.workType || log.displayName || "")).trim();
    const type = log.folder === "seed" ? displayName : buildDiaryTypeLabel(displayName, rowWorkType);

    // worker 系列を抽出（worker1, worker2... / worker 単一列の両対応）
    const workers = [];
    Object.keys(log.data).forEach(key => {
      if (key.startsWith("worker") && log.data[key]) {
        workers.push(log.data[key]);
      }
    });

    if (workers.length === 0 && log.data.worker) {
      String(log.data.worker)
        .split(/[\/／]/)
        .map(v => v.trim())
        .filter(Boolean)
        .forEach(v => workers.push(v));
    }

    // ★ field 抽出（headerName に field がある場合のみ）
    let field = "";
    if (log.headerName.includes("field")) {
      const rawField = String(log.data["field"] ?? "").trim();
      // 「圃場A／圃場B」形式にも対応して、複数圃場を保持する
      field = rawField
        ? Array.from(
            new Set(
              rawField
                .split(/[\/／]/)
                .map(v => v.trim())
                .filter(Boolean)
            )
          ).join("／")
        : "";
    }

    // ★ machine 抽出（headerName に machine がある場合のみ）
    const machine = log.headerName.includes("machine")
      ? String(log.data["machine"] ?? "").trim()
      : "";

    const sourceDate = String(log.data[log.dateColumn] || "").trim();
    const timestampKey = buildTimestampKey({
      date: sourceDate,
      folder: log.folder,
      workType: String(log.data.workType || log.displayName || "").trim(),
      field,
      workers,
      machine
    });
    const timestampRow = timestampMap.get(timestampKey) || findRelaxedTimestampRow({
      sourceDate,
      folder: log.folder,
      workType: String(log.data.workType || "").trim(),
      field,
      workers,
      machine
    }, timestampRows);
    const sourceKey = buildSourceKey({
      folder: log.folder,
      date: sourceDate,
      type: sourceTypeKey,
      field,
      machine,
      workers,
      data: log.data
    });

    autoList.push({
      logIndex,
      folder: log.folder,
      date: sourceDate,
      type,
      sowingCategory: rowWorkType,
      workers,
      workersKey: buildWorkersSetKey(workers),
      field,
      machine,
      sourceKey,
      timestampKey,
      sessionKey: timestampRow?.sessionKey || "",
      timestampTime: timestampRow?.time || ""
    });
  });

  return autoList;
}

export function mergeWorkEntries(autoList, timestampRows = []) {
  const timestampMap = buildTimestampMap(timestampRows);
  const groups = [];

  autoList.forEach((item, index) => {
    const match = timestampMap.get(String(item.timestampKey || "").trim().toLowerCase()) || null;
    const sessionKey = String(item.sessionKey || match?.sessionKey || "").trim();

    let group = null;
    if (sessionKey) {
      group = groups.find(entry => entry.groupKey === sessionKey);
    }

    if (!group) {
      const groupKey = sessionKey || `${item.sourceKey || item.type || "work"}#${index}`;
      group = {
        groupKey,
        sessionKey,
        type: item.type,
        sourceKey: item.sourceKey,
        sowingCategorySet: new Set(),
        items: [],
        fieldSet: new Set(),
        workerSet: new Set(),
        machine: String(item.machine || "").trim(),
        start: "",
        end: "",
        timestampTimes: []
      };
      groups.push(group);
    }

    group.items.push({ ...item, __index: index });
  normalizeMultiText(item.sowingCategory || item.workType || item.type || "").split("／").map(v => v.trim()).filter(Boolean).forEach(v => group.sowingCategorySet.add(v));

    normalizeMultiText(item.field).split("／").map(v => v.trim()).filter(Boolean).forEach(v => group.fieldSet.add(v));
    normalizeMultiText(item.workers).split("／").map(v => v.trim()).filter(Boolean).forEach(v => group.workerSet.add(v));

    if (!group.machine && item.machine) {
      group.machine = String(item.machine || "").trim();
    }

    const time = String(match?.time || item.timestampTime || "").trim();
    if (time) group.timestampTimes.push(time);
  });

  return groups.map(group => {
    const times = group.timestampTimes.slice().sort((a, b) => a.localeCompare(b));
    const start = times[0] || "";
    const end = times.length ? times[times.length - 1] : "";

    return {
      groupKey: group.groupKey,
      sessionKey: group.sessionKey,
      type: group.type,
      sourceKey: group.sourceKey,
      sowingCategory: [...group.sowingCategorySet].join("／"),
      field: [...group.fieldSet].join("／"),
      workers: [...group.workerSet].join("／"),
      machine: group.machine,
      start,
      end,
      items: group.items.sort((a, b) => String(a.timestampTime || "").localeCompare(String(b.timestampTime || "")) || (a.__index - b.__index))
    };
  }).sort((a, b) => {
    const aStart = a.start || a.end || "99:99";
    const bStart = b.start || b.end || "99:99";
    return aStart.localeCompare(bStart) || String(a.type || "").localeCompare(String(b.type || ""), "ja");
  });
}


function buildWorkersSetKey(workers) {
  const values = Array.isArray(workers)
    ? workers
    : String(workers || "").split(/[\/／]/);

  return values
    .map(v => normalizeToken(v))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "ja"))
    .join("/");
}

function buildTimestampMap(timestampRows) {
  const map = new Map();
  (Array.isArray(timestampRows) ? timestampRows : []).forEach(row => {
    const key = String(row?.workKey || "").trim().toLowerCase();
    if (!key || map.has(key)) return;
    map.set(key, row);
  });
  return map;
}

function findRelaxedTimestampRow(base, timestampRows) {
  const date = String(base?.sourceDate || "").trim();
  const folder = normalizeToken(base?.folder || "");
  const workType = normalizeToken(base?.workType || "");
  const machine = normalizeToken(base?.machine || "");
  const workersText = normalizeToken(normalizeMultiText(base?.workers || ""));
  const fieldSet = new Set(
    normalizeMultiText(base?.field || "")
      .split("／")
      .map(v => normalizeToken(v))
      .filter(Boolean)
  );

  const candidates = (Array.isArray(timestampRows) ? timestampRows : []).filter(row => {
    if (String(row?.date || "").trim() !== date) return false;
    if (normalizeToken(row?.folder || "") !== folder) return false;
    if (machine && normalizeToken(row?.machine || "") !== machine) return false;
    if (workersText && normalizeToken(row?.workers || "") !== workersText) return false;

    if (fieldSet.size > 0) {
      const rowField = normalizeToken(row?.field || "");
      if (!rowField || !fieldSet.has(rowField)) return false;
    }

    return true;
  });

  if (!candidates.length) return null;

  const scored = candidates.map((row, index) => {
    let score = 0;
    const rowType = normalizeToken(row?.workType || "");
    if (workType && rowType === workType) score += 2;
    if (row?.sessionKey) score += 1;
    return { row, score, index };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const ta = String(a.row?.time || "");
    const tb = String(b.row?.time || "");
    const timeCmp = ta.localeCompare(tb);
    if (timeCmp !== 0) return timeCmp;
    return a.index - b.index;
  });

  return scored[0]?.row || null;
}

function normalizeMultiText(value) {
  if (Array.isArray(value)) {
    return value.map(v => String(v || "").trim()).filter(Boolean).join("／");
  }
  return String(value || "").trim();
}

function buildSourceKey({ folder, date, type, field, machine, workers, data }) {
  const workerText = Array.isArray(workers)
    ? workers.map(v => normalizeToken(v)).filter(Boolean).join("/")
    : normalizeToken(workers);

  const rowText = Object.keys(data || {})
    .sort((a, b) => a.localeCompare(b))
    .map(k => `${k}:${normalizeToken(data[k])}`)
    .join("|");

  return [
    "v1",
    normalizeToken(folder),
    normalizeToken(date),
    normalizeToken(type),
    normalizeToken(field),
    normalizeToken(machine),
    workerText,
    rowText
  ].join("#");
}

function normalizeToken(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function extractWorkerText(data) {
  const values = [];

  Object.keys(data || {}).forEach(key => {
    if (key.startsWith("worker") && data[key]) {
      values.push(String(data[key]).trim());
    }
  });

  if (!values.length && data?.worker) {
    String(data.worker)
      .split(/[\/／]/)
      .map(v => v.trim())
      .filter(Boolean)
      .forEach(v => values.push(v));
  }

  return Array.from(new Set(values)).join("／");
}

function buildSnippet(headerName, dateColumn, data) {
  const keys = (Array.isArray(headerName) ? headerName : Object.keys(data || {}))
    .filter(key => key !== dateColumn)
    .filter(key => key !== "human")
    .slice(0, 6);

  const values = keys
    .map(key => String(data?.[key] || "").trim())
    .filter(Boolean)
    .slice(0, 3);

  return values.join(" / ");
}

function buildSearchText(displayName, headerName, data) {
  const values = [displayName];
  (Array.isArray(headerName) ? headerName : Object.keys(data || {})).forEach(key => {
    values.push(String(data?.[key] || ""));
  });

  return normalizeToken(values.join(" "));
}

function buildDiaryTypeLabel(displayName, workType) {
  const base = String(displayName || "").trim();
  const detail = String(workType || "").trim();

  if (!base && !detail) return "";
  if (!base) return detail;
  if (!detail) return base;
  if (normalizeToken(base) === normalizeToken(detail)) return base;
  return `${base}：${detail}`;
}
