// kpi-year-index.js
// year-index.json を CSV だけで生成する最小構成版（揺れ吸収＋品種フィルタ対応）
// ・fields.json は使わない（圃場フィルタ除外）
// ・varieties.json は使う（品種フィルタ維持）
// ・CSV の field / variety / harvestPlanYM を唯一の正とする
// ・folder = summary のフォルダ名
// ・file = summary のファイル名
// ・plantingRef は CSV と summary の揺れを normalize して一致させる

import { loadSummaryIndex, loadSummaryJSON } from "./kpi-data-loader.js";
import { sha256 } from "/common/sha256.js";
import { saveJSON, loadJSON } from "/common/json.js";
import { loadCSV, normalizeKeys } from "/common/csv.js";

const DEBUG = true;

/* ---------------------------------------------------------
   plantingRef の揺れを吸収する正規化関数
--------------------------------------------------------- */
function normalizeRef(ref) {
  if (!ref) return "";
  return ref
    .replace(/[()（）]/g, "")
    .replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
    .replace(/[‐‑‒–—―]/g, "-")     // ハイフン統一
    .replace(/[＿﹍﹎ˍ]/g, "_")     // アンダーバー統一 ← ★今回の決定打
    .replace(/\s+/g, "")
    .replace(/\r/g, "")
    .trim();
}


export async function computeSummaryIndexHash() {
  const summaryIndex = await loadSummaryIndex();
  return sha256(JSON.stringify(summaryIndex));
}

export async function checkYearIndexNeedsUpdate(yearIndex) {
  const currentHash = await computeSummaryIndexHash();
  return yearIndex.lastSummaryIndexHash !== currentHash;
}

export async function generateYearIndex() {
  const summaryIndex = await loadSummaryIndex();

  // ▼ CSV（唯一の正）
  const plantingRows = normalizeKeys(await loadCSV("/logs/planting/all.csv"));

  // ▼ varieties.json（品種フィルタ用）
  const varieties = await loadJSON("/data/varieties.json");
  const varietyTypeMap = Object.fromEntries(
    varieties.map(v => [v.name, v.type])
  );

  // ▼ CSV の plantingRef → CSV 行（正規化してマップ化）
  const csvRefMap = {};
  for (const r of plantingRows) {
    const key = normalizeRef(r.plantingRef);
    csvRefMap[key] = r;
  }

  const result = {};
  const currentHash = await computeSummaryIndexHash();

  for (const folderField in summaryIndex) {
    for (const year in summaryIndex[folderField]) {
      for (const file of summaryIndex[folderField][year]) {

        const summary = await loadSummaryJSON(
          `/logs/summary/${folderField}/${year}/${file}`
        );

        const rawRef =
          summary?.planting?.plantingRef ??
          file.replace(".json", "");

        const normRef = normalizeRef(rawRef);

        const csvRow = csvRefMap[normRef];

        if (!csvRow) {
          console.warn("[WARN] CSV に存在しない plantingRef:", rawRef);
          continue;
        }

        const variety = csvRow.variety;
        const varietyType = varietyTypeMap[variety] ?? null;

        const planYear = Number(csvRow.harvestPlanYM.split("-")[0]);

        if (!result[planYear]) result[planYear] = [];

        result[planYear].push({
          field: csvRow.field,      // CSV の圃場名（フィルタには使わない）
          variety,                  // CSV の品名
          varietyType,              // varieties.json の type
          harvestPlanYM: csvRow.harvestPlanYM,
          year,
          file,
          folder: folderField,
          plantingRef: rawRef
        });
      }
    }
  }

  result.lastSummaryIndexHash = currentHash;

  if (DEBUG) console.log("[DEBUG] year-index.json:", result);

  return result;
}

export async function saveYearIndex(newIndex) {
  // ★ 読み込み側と必ず同じパスにする（先頭 / 必須）
  await saveJSON("data/year-index.json", newIndex);
}
