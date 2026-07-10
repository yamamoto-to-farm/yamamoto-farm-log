// =========================================================
// common/general-log/base.js
// 圃場ログの汎用保存エンジン（saveLog 版）
// =========================================================

import { loadJSON } from "/common/json.js?v=1";
import { saveLog } from "/common/save/index.js?v=1";
import { safeFieldName, safeFileName } from "/common/utils.js?v=1";
import { recordMonthlyWorkEntries } from "/common/monthly-work-summary.js?v=1";
import { saveTimestampRows } from "/common/timestamp.js?v=1";

const DEBUG = true;
function debugLog(...args) {
  if (DEBUG) console.log("[base-log]", ...args);
}

/* ---------------------------------------------------------
   1. JSON 読み込み（404 → 空データ扱い）
--------------------------------------------------------- */
export async function loadFieldLog(type, fieldName) {
  const path = `/logs/${type}/${fieldName}.json`;

  try {
    const data = await loadJSON(path);

    // 404 → {} が返るので補正
    if (!data || Object.keys(data).length === 0) {
      debugLog(`[loadFieldLog] 初回作成: ${path}`);
      return {
        field: fieldName,
        years: {}
      };
    }

    return data;

  } catch (e) {
    debugLog("[loadFieldLog] error → 初回扱い", e);
    return {
      field: fieldName,
      years: {}
    };
  }
}

/* ---------------------------------------------------------
   2. 年次階層の確保
--------------------------------------------------------- */
function ensureYear(data, year) {
  if (!data.years[year]) {
    data.years[year] = { entries: [] };
  }
}

class DuplicateLogError extends Error {
  constructor(message) {
    super(message);
    this.name = "DuplicateLogError";
    this.code = "DUPLICATE_LOG";
  }
}

function normalizeScalarForDuplicate(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return 0;
    return Math.round(value * 1000) / 1000;
  }

  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "boolean") {
    return value;
  }

  return value;
}

function normalizeForDuplicate(value) {
  if (value == null) return null;

  if (Array.isArray(value)) {
    const arr = value.map(v => normalizeForDuplicate(v));
    return arr.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }

  if (typeof value === "object") {
    const out = {};
    Object.keys(value)
      .sort()
      .forEach(key => {
        out[key] = normalizeForDuplicate(value[key]);
      });
    return out;
  }

  return normalizeScalarForDuplicate(value);
}

function isDuplicateEntry(existingEntry, newEntry) {
  const lhs = JSON.stringify(normalizeForDuplicate(existingEntry));
  const rhs = JSON.stringify(normalizeForDuplicate(newEntry));
  return lhs === rhs;
}

/* ---------------------------------------------------------
   3. インデックス読み込み（正規構造を優先）
--------------------------------------------------------- */
async function loadIndex(type) {

  // 正規構造（Farm OS 標準）
  const pathB = `/data/${type}/${type}-index.json`;

  // 旧構造（互換）
  const pathA = `/data/${type}-index.json`;

  // B を先に試す（404 は空扱い）
  let data = await safeLoadIndexJson(pathB);
  if (data && Object.keys(data).length !== 0) {
    debugLog(`[loadIndex] loaded from B: ${pathB}`);
    return data;
  }

  // A を試す（404 は空扱い）
  data = await safeLoadIndexJson(pathA);
  if (data && Object.keys(data).length !== 0) {
    debugLog(`[loadIndex] loaded from A: ${pathA}`);
    return data;
  }

  // どちらも無い → 初回保存用
  debugLog(`[loadIndex] no index found → empty object`);
  return {};
}

async function safeLoadIndexJson(path) {
  try {
    const data = await loadJSON(path);
    return data && typeof data === "object" ? data : {};
  } catch (e) {
    debugLog(`[loadIndex] missing or unreadable: ${path}`);
    return {};
  }
}

/* ---------------------------------------------------------
   4. インデックス更新（正規構造を優先して保存）
--------------------------------------------------------- */
async function updateIndex(type, field, year, fileName) {
  const index = await loadIndex(type);

  if (!index[field]) index[field] = {};
  if (!index[field][year]) index[field][year] = [];

  if (!index[field][year].includes(fileName)) {
    index[field][year].push(fileName);
    index[field][year].sort();
  }

  // 保存先候補
  const pathB = `data/${type}/${type}-index.json`;  // 正規構造
  const pathA = `data/${type}-index.json`;          // 旧構造

  let savePath = pathB;

  try {
    // B が存在するなら B に保存
    const resB = await fetch(`/${pathB}`, { method: "HEAD" });
    if (resB.ok) {
      savePath = pathB;
    } else {
      // B が無い → A を試す
      const resA = await fetch(`/${pathA}`, { method: "HEAD" });
      if (resA.ok) savePath = pathA;
    }
  } catch (e) {
    // どちらも無い → 正規構造で新規作成
    savePath = pathB;
  }

  await saveLog({
    type: "multi",
    suppressModal: true,
    files: [
      {
        path: savePath,
        content: JSON.stringify(index, null, 2)
      }
    ]
  });

  debugLog("[updateIndex] saved:", savePath);
}

/* ---------------------------------------------------------
   5. 複数圃場ログ保存（按分はしないが、圃場ごとに絞り込む）
--------------------------------------------------------- */
export async function saveMultiFieldLog({
  type,      // fertilizer / pesticide / water など
  date,      // "2026-05-10"
  fields,    // ["ぎょうざ東1", "ぎょうざ東2"]
  entry      // { distributed, machine, worker, notes } など完成形
}) {
  const year = date.substring(0, 4);
  const savedFields = [];
  const skippedFields = [];

  debugLog("[saveMultiFieldLog] start", { type, date, fields, entry });

  for (const field of fields) {
    const safeField = safeFieldName(field);
    const filePath = `logs/${type}/${safeField}.json`;

    // JSON 読み込み（404 → 空データ）
    const data = await loadFieldLog(type, safeField);

    // 年次階層を確保
    ensureYear(data, year);

    // ★ distributed を圃場ごとに絞る
    let perFieldDistributed = undefined;
    if (Array.isArray(entry.distributed)) {
      perFieldDistributed = entry.distributed.filter(d => d.field === field);
    }

    // ★ entry を圃場ごとに調整
    const storedEntry = {
      date,
      ...entry,
      ...(perFieldDistributed !== undefined ? { distributed: perFieldDistributed } : {})
    };

    const exists = data.years[year].entries.some(e => isDuplicateEntry(e, storedEntry));
    if (exists) {
      skippedFields.push(field);
      debugLog("[saveMultiFieldLog] duplicate skipped:", { type, field, date });
      continue;
    }

    data.years[year].entries.push(storedEntry);

    // 保存
    await saveLog({
      type: "multi",
      suppressModal: true,
      files: [
        {
          path: filePath,
          content: JSON.stringify(data, null, 2)
        }
      ]
    });

    debugLog("[saveMultiFieldLog] saved:", filePath);
    savedFields.push(field);

    // インデックス更新
    const fileName = `${date}-${safeFileName(type)}.json`;
    await updateIndex(type, safeField, year, fileName);
  }

  if (savedFields.length === 0 && skippedFields.length > 0) {
    throw new DuplicateLogError("同じ内容のログが既に存在します（重複保存はスキップしました）。");
  }

  // 日誌表示向けの軽量サマリ（all.csv）を同時更新
  if (savedFields.length > 0) {
    await updateGeneralAllCsv(type, { date, fields: savedFields, entry });

    const currentTime = getCurrentTimeText();

    await saveTimestampRows(savedFields.map(field => ({
      date,
      folder: type,
      workType: entry.workType || type,
      field,
      workers: normalizeWorker(entry),
      machine: normalizeMachine(entry),
      time: currentTime
    }))).catch(e => {
      console.warn("[saveMultiFieldLog] timestamp update failed:", e);
    });

    await recordMonthlyWorkEntries({
      date,
      sourceKey: type,
      count: savedFields.length
    }).catch(e => {
      console.warn("[saveMultiFieldLog] monthly work summary update failed:", e);
    });
  }

  debugLog("[saveMultiFieldLog] done", {
    savedFields,
    skippedFields
  });
}

function getCurrentTimeText() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

async function updateGeneralAllCsv(type, { date, fields, entry }) {
  const header = "date,worker,field,machine,workType,method";
  const worker = normalizeWorker(entry);
  const field = Array.isArray(fields) ? fields.join("／") : "";
  const machine = normalizeMachine(entry);
  const workType = normalizeWorkType(entry);
  const method = normalizeMethod(entry);
  const newRow = { date, worker, field, machine, workType, method };

  const path = `/logs/${type}/all.csv`;
  let content = buildAllCsvContent(header, [], newRow);

  try {
    const res = await fetch(`${path}?ts=${Date.now()}`);
    if (res.ok) {
      const text = await res.text();
      const existingRows = parseAllCsvRows(text);
      content = buildAllCsvContent(header, existingRows, newRow);
    }
  } catch (e) {
    debugLog("[updateGeneralAllCsv] existing all.csv read failed -> create new", e);
  }

  await saveLog({
    type,
    suppressModal: true,
    replaceCsv: content,
    fileName: "all.csv"
  });

  debugLog("[updateGeneralAllCsv] saved:", `logs/${type}/all.csv`);
}

function buildAllCsvContent(header, rows, appendedRow) {
  const allRows = [...rows, appendedRow]
    .map(r => [r.date, r.worker, r.field, r.machine, r.workType, r.method].map(toCsvCell).join(","))
    .join("\n");

  return `${header}\n${allRows}\n`;
}

function parseAllCsvRows(csvText) {
  const normalized = String(csvText || "").replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const lines = normalized
    .split("\n")
    .map(v => v.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];

  const firstCols = parseCsvLine(lines[0]).map(v => String(v || "").trim().toLowerCase());
  const looksHeader = firstCols.includes("date") && firstCols.includes("worker") && firstCols.includes("field");

  let colIndex = { date: 0, worker: 1, field: 2, machine: -1, workType: -1, method: -1 };
  let startLine = 0;

  if (looksHeader) {
    colIndex = {
      date: firstCols.indexOf("date"),
      worker: firstCols.indexOf("worker"),
      field: firstCols.indexOf("field"),
      machine: firstCols.indexOf("machine"),
      workType: firstCols.indexOf("worktype"),
      method: firstCols.indexOf("method")
    };
    startLine = 1;
  }

  const rows = [];
  for (let i = startLine; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const date = pickCsvCol(cols, colIndex.date);
    const worker = pickCsvCol(cols, colIndex.worker);
    const field = pickCsvCol(cols, colIndex.field);
    const machine = pickCsvCol(cols, colIndex.machine);
    const workType = pickCsvCol(cols, colIndex.workType);
    const method = pickCsvCol(cols, colIndex.method);

    if (!date && !worker && !field && !machine && !workType && !method) continue;
    rows.push({ date, worker, field, machine, workType, method });
  }

  return rows;
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }

    cur += ch;
  }

  out.push(cur);
  return out;
}

function pickCsvCol(cols, index) {
  if (!Array.isArray(cols)) return "";
  if (typeof index !== "number" || index < 0) return "";
  return String(cols[index] ?? "").trim();
}

function normalizeWorker(entry) {
  if (!entry) return "";

  // general-log では workers（複数）または worker（単数）の両方があり得る
  const raw = entry.workers ?? entry.worker ?? "";

  if (Array.isArray(raw)) {
    return raw.map(v => String(v || "").trim()).filter(Boolean).join("／");
  }

  const text = String(raw || "").trim();
  if (!text) return "";

  // 単一文字列で渡された場合も、カンマ区切りなら作業者区切りとして正規化する
  if (text.includes(",") || text.includes("、")) {
    return text
      .split(/[、,]/)
      .map(v => v.trim())
      .filter(Boolean)
      .join("／");
  }

  return text;
}

function normalizeMachine(entry) {
  if (!entry) return "";

  const raw = entry.machine ?? "";
  if (Array.isArray(raw)) {
    return raw.map(v => String(v || "").trim()).filter(Boolean).join("／");
  }

  return String(raw || "").trim();
}

function normalizeWorkType(entry) {
  if (!entry) return "";
  return String(entry.workType || "").trim();
}

function normalizeMethod(entry) {
  if (!entry) return "";
  const spray = String(entry.sprayMethod || "").trim();
  const mowing = String(entry.mowingMethod || "").trim();
  return spray || mowing;
}

function toCsvCell(value) {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/* ---------------------------------------------------------
   全圃場ログ読み込み（fertilizer / pesticide 共通）
--------------------------------------------------------- */
export async function loadAllLogs(type) {
  const index = await loadIndex(type);
  const result = [];

  for (const field in index) {
    for (const year in index[field]) {
      for (const file of index[field][year]) {
        const path = `/logs/${type}/${file}`;
        const data = await loadJSON(path);

        if (data && data.years && data.years[year]) {
          result.push({
            field,
            year,
            entries: data.years[year].entries
          });
        }
      }
    }
  }

  return result;
}
