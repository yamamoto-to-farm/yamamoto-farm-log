// =========================================================
// common/general-log/base.js
// 圃場ログの汎用保存エンジン（saveLog 版）
// =========================================================

import { loadJSON } from "/common/json.js?v=1";
import { saveLog } from "/common/save/index.js?v=1";
import { safeFieldName, safeFileName } from "/common/utils.js?v=1";

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

/* ---------------------------------------------------------
   3. インデックス読み込み（正規構造を優先）
--------------------------------------------------------- */
async function loadIndex(type) {

  // 正規構造（Farm OS 標準）
  const pathB = `/data/${type}/${type}-index.json`;

  // 旧構造（互換）
  const pathA = `/data/${type}-index.json`;

  // B を先に試す
  let data = await loadJSON(pathB);
  if (data && Object.keys(data).length !== 0) {
    debugLog(`[loadIndex] loaded from B: ${pathB}`);
    return data;
  }

  // A を試す
  data = await loadJSON(pathA);
  if (data && Object.keys(data).length !== 0) {
    debugLog(`[loadIndex] loaded from A: ${pathA}`);
    return data;
  }

  // どちらも無い → 初回保存用
  debugLog(`[loadIndex] no index found → empty object`);
  return {};
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

    data.years[year].entries.push(storedEntry);

    // 保存
    await saveLog({
      type: "multi",
      files: [
        {
          path: filePath,
          content: JSON.stringify(data, null, 2)
        }
      ]
    });

    debugLog("[saveMultiFieldLog] saved:", filePath);

    // インデックス更新
    const fileName = `${date}-${safeFileName(type)}.json`;
    await updateIndex(type, safeField, year, fileName);
  }

  // 日誌表示向けの軽量サマリ（all.csv）を同時更新
  await updateGeneralAllCsv(type, { date, fields, entry });

  debugLog("[saveMultiFieldLog] done");
}

async function updateGeneralAllCsv(type, { date, fields, entry }) {
  const header = "date,worker,field";
  const worker = normalizeWorker(entry);
  const field = Array.isArray(fields) ? fields.join("／") : "";
  const line = [date, worker, field].map(toCsvCell).join(",");

  const path = `/logs/${type}/all.csv`;
  let content = `${header}\n${line}\n`;

  try {
    const res = await fetch(`${path}?ts=${Date.now()}`);
    if (res.ok) {
      const text = await res.text();
      const normalized = String(text || "").replace(/\r\n/g, "\n").trim();

      if (normalized) {
        if (normalized.startsWith(header)) {
          content = `${normalized}\n${line}\n`;
        } else {
          content = `${header}\n${normalized}\n${line}\n`;
        }
      }
    }
  } catch (e) {
    debugLog("[updateGeneralAllCsv] existing all.csv read failed -> create new", e);
  }

  await saveLog({
    type,
    replaceCsv: content,
    fileName: "all.csv"
  });

  debugLog("[updateGeneralAllCsv] saved:", `logs/${type}/all.csv`);
}

function normalizeWorker(entry) {
  if (!entry) return "";

  // general-log では workers（複数）または worker（単数）の両方があり得る
  const raw = entry.workers ?? entry.worker ?? "";

  if (Array.isArray(raw)) {
    return raw.map(v => String(v || "").trim()).filter(Boolean).join("／");
  }

  return String(raw || "").trim();
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
