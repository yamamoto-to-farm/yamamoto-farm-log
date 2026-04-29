// kpi-year-index.js
// year-index.json を CSV だけで生成する決定版（揺れ吸収版）
// ・name = CSV.field（唯一の正）
// ・area = fields.json.name[name]
// ・folder = summary のフォルダ名（読み込み用）
// ・summary の field は一切使わない

import { loadSummaryIndex, loadSummaryJSON } from "./kpi-data-loader.js";
import { sha256 } from "/common/sha256.js";
import { saveJSON, loadJSON } from "/common/json.js";
import { loadCSV, normalizeKeys } from "/common/csv.js";

const DEBUG = true;

/* ---------------------------------------------------------
   plantingRef の揺れを吸収する正規化関数
   ・全角数字 → 半角
   ・全角/異体ハイフン → 半角ハイフン
   ・括弧除去
   ・空白除去
   ・CR除去
--------------------------------------------------------- */
function normalizeRef(ref) {
  if (!ref) return "";
  return ref
    .replace(/[()（）]/g, "")
    .replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
    .replace(/[‐‑‒–—―]/g, "-")
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

  // ▼ fields.json（CSV.field と一致する name を持つ）
  const fields = await loadJSON("/data/fields.json");
  const fieldAreaMap = Object.fromEntries(fields.map(f => [f.name, f.area]));

  // ▼ varieties.json
  const varieties = await loadJSON("/data/varieties.json");
  const varietyTypeMap = Object.fromEntries(varieties.map(v => [v.name, v.type]));

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

        const name = csvRow.field;               // CSV が唯一の正
        const area = fieldAreaMap[name] ?? null; // fields.json から取得
        const variety = csvRow.variety;
        const varietyType = varietyTypeMap[variety] ?? null;

        const planYear = Number(csvRow.harvestPlanYM.split("-")[0]);

        if (!result[planYear]) result[planYear] = [];

        result[planYear].push({
          name,          // CSV の field
          area,          // fields.json.name[name]
          variety,
          varietyType,
          year,
          file,
          folder: folderField,  // summary 読み込み用
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
  await saveJSON("/data/year-index.json", newIndex);
}
