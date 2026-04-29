// kpi-year-index.js
// year-index.json の生成・更新・ハッシュ管理（CSV 補完対応 + デバッグ付き）

import { loadSummaryIndex, loadSummaryJSON } from "./kpi-data-loader.js";
import { sha256 } from "/common/sha256.js";
import { saveJSON, loadJSON } from "/common/json.js";
import { loadCSV, normalizeKeys } from "/common/csv.js";

/* ===============================
   デバッグフラグ
=============================== */
const DEBUG_YEAR_INDEX = true;

/* ===============================
   summary-index.json のハッシュ計算
=============================== */
export async function computeSummaryIndexHash() {
  const summaryIndex = await loadSummaryIndex();
  return sha256(JSON.stringify(summaryIndex));
}

/* ===============================
   更新が必要かどうか判定
=============================== */
export async function checkYearIndexNeedsUpdate(yearIndex) {
  const currentHash = await computeSummaryIndexHash();
  return yearIndex.lastSummaryIndexHash !== currentHash;
}

/* ===============================
   year-index.json の生成
=============================== */
export async function generateYearIndex() {
  const summaryIndex = await loadSummaryIndex();

  // ▼ fields.json / varieties.json を読み込む
  const fields = await loadJSON("/data/fields.json");
  const varieties = await loadJSON("/data/varieties.json");

  // ▼ CSV を読み込んで field → area を補完する
  const plantingRows = normalizeKeys(await loadCSV("/logs/planting/all.csv"));
  const csvFieldAreaMap = {};
  plantingRows.forEach(r => {
    if (r.field && r.area) {
      csvFieldAreaMap[r.field] = r.area;
    }
  });

  if (DEBUG_YEAR_INDEX) {
    console.log("=== [DEBUG] fields.json ===", fields);
    console.log("=== [DEBUG] varieties.json ===", varieties);
    console.log("=== [DEBUG] CSV field → area ===", csvFieldAreaMap);
  }

  // ▼ field → area マップ（fields.json）
  const fieldMap = Object.fromEntries(
    (fields || []).map(f => [f.name, f.area])
  );

  // ▼ variety → type マップ
  const varietyMap = Object.fromEntries(
    (varieties || []).map(v => [v.name, v.type])
  );

  if (DEBUG_YEAR_INDEX) {
    console.log("=== [DEBUG] fieldMap (fields.json) ===", fieldMap);
    console.log("=== [DEBUG] varietyMap ===", varietyMap);
  }

  const result = {};
  const currentHash = await computeSummaryIndexHash();

  for (const field in summaryIndex) {
    for (const year in summaryIndex[field]) {
      for (const file of summaryIndex[field][year]) {

        const path = `/logs/summary/${field}/${year}/${file}`;
        const summary = await loadSummaryJSON(path);

        const planting = summary?.planting ?? {};
        const planYM = planting.harvestPlanYM ?? "";
        const planYear = Number(planYM.split("-")[0]);

        const variety = planting.variety ?? "";

        // ★ area 補完ロジック（CSV → fields.json → null）
        const area =
          csvFieldAreaMap[field] ??
          fieldMap[field] ??
          null;

        // ★ varietyType 補完
        const varietyType = varietyMap[variety] ?? null;

        if (DEBUG_YEAR_INDEX) {
          console.log(`[DEBUG] field="${field}" → area="${area}"`);
          console.log(`[DEBUG] variety="${variety}" → varietyType="${varietyType}"`);
        }

        const plantingRef = file.replace(".json", "");

        if (!result[planYear]) result[planYear] = [];

        result[planYear].push({
          field,
          area,
          variety,
          varietyType,
          year,
          file,
          plantingRef
        });
      }
    }
  }

  result.lastSummaryIndexHash = currentHash;

  if (DEBUG_YEAR_INDEX) {
    console.log("=== [DEBUG] year-index.json (生成結果) ===");
    console.log(result);
  }

  return result;
}

/* ===============================
   year-index.json を保存
=============================== */
export async function saveYearIndex(newIndex) {
  await saveJSON("/data/year-index.json", newIndex);
}
