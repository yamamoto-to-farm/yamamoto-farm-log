// kpi-year-index.js
// year-index.json の生成・更新・ハッシュ管理（area / varietyType 対応 + デバッグ付き）

import { loadSummaryIndex, loadSummaryJSON } from "./kpi-data-loader.js";
import { sha256 } from "/common/sha256.js";
import { saveJSON, loadJSON } from "/common/json.js";

/* ===============================
   デバッグフラグ
   true にすると fields / varieties / mapping を console に出力
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
  const fields = await loadJSON("/data/fields.json?v=1");
  const varieties = await loadJSON("/data/varieties.json?v=1");

  if (DEBUG_YEAR_INDEX) {
    console.log("=== [DEBUG] fields.json ===");
    console.log(fields);

    console.log("=== [DEBUG] varieties.json ===");
    console.log(varieties);
  }

  // ▼ field → area マップ
  const fieldMap = Object.fromEntries(
    (fields || []).map(f => [f.name, f.area])
  );

  // ▼ variety → type マップ
  const varietyMap = Object.fromEntries(
    (varieties || []).map(v => [v.name, v.type])
  );

  if (DEBUG_YEAR_INDEX) {
    console.log("=== [DEBUG] fieldMap (field → area) ===");
    console.log(fieldMap);

    console.log("=== [DEBUG] varietyMap (variety → type) ===");
    console.log(varietyMap);
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

        // ★ マッピング
        const area = fieldMap[field] ?? null;
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
   year-index.json を保存（saveJSON 方式）
=============================== */
export async function saveYearIndex(newIndex) {
  await saveJSON("data/year-index.json", newIndex);
}
