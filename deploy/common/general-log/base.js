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
   3. インデックス読み込み（階層構造の揺れを吸収）
--------------------------------------------------------- */
async function loadIndex(type) {

  // A. ルート直下型
  const pathA = `/data/${type}-index.json`;

  // B. ディレクトリ型
  const pathB = `/data/${type}/${type}-index.json`;

  // A を試す
  let data = await loadJSON(pathA);
  if (data && Object.keys(data).length !== 0) {
    debugLog(`[loadIndex] loaded from A: ${pathA}`);
    return data;
  }

  // B を試す
  data = await loadJSON(pathB);
  if (data && Object.keys(data).length !== 0) {
    debugLog(`[loadIndex] loaded from B: ${pathB}`);
    return data;
  }

  // どちらも無い → 初回保存用
  debugLog(`[loadIndex] no index found → empty object`);
  return {};
}

/* ---------------------------------------------------------
   4. インデックス更新（saveLog で保存）
   読み込みと同じく、保存先も揺れ吸収する
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
  const pathA = `data/${type}-index.json`;          // ルート直下型
  const pathB = `data/${type}/${type}-index.json`;  // ディレクトリ型

  // どちらが存在するかチェック
  let savePath = pathA;

  try {
    const resA = await fetch(`/${pathA}`, { method: "HEAD" });
    if (resA.ok) savePath = pathA;
    else {
      const resB = await fetch(`/${pathB}`, { method: "HEAD" });
      if (resB.ok) savePath = pathB;
    }
  } catch (e) {
    // どちらも無い → pathA に新規作成
    savePath = pathA;
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
   5. 複数圃場ログ保存（按分はしない）
--------------------------------------------------------- */
export async function saveMultiFieldLog({
  type,      // fertilizer / pesticide / water など
  date,      // "2026-05-10"
  fields,    // ["ぎょうざ東1", "ぎょうざ東2"]
  entry      // ★ 按分済み or 完成形の entry をそのまま保存
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

    // ★ entry は “完成形” をそのまま保存
    data.years[year].entries.push({
      date,
      ...entry
    });

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

  debugLog("[saveMultiFieldLog] done");
}
