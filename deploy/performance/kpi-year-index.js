// kpi-year-index.js
// summary-index.json だけから year-index.json を生成する決定版
// ・CSV は使わない（揺れゼロ）
// ・summary-index.json → summary.json から必要情報だけ抽出
// ・varieties.json で varietyType を付与
// ・plantingRef は file 名から抽出（揺れなし）
// ・保存パスは data/year-index.json（先頭 / なし）

import { loadSummaryIndex, loadSummaryJSON } from "./kpi-data-loader.js";
import { sha256 } from "/common/sha256.js";
import { saveJSON, loadJSON } from "/common/json.js";

const DEBUG = true;

/* ---------------------------------------------------------
   plantingRef を file 名から抽出（揺れゼロ）
--------------------------------------------------------- */
function extractRefFromFile(file) {
  return file.replace(".json", "");
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

  // ▼ varieties.json（品種タイプ付与用）
  const varieties = await loadJSON("/data/varieties.json");
  const varietyTypeMap = Object.fromEntries(
    varieties.map(v => [v.name, v.type])
  );

  const result = {};
  const currentHash = await computeSummaryIndexHash();

  for (const folderField in summaryIndex) {
    for (const year in summaryIndex[folderField]) {
      for (const file of summaryIndex[folderField][year]) {

        const summary = await loadSummaryJSON(
          `/logs/summary/${folderField}/${year}/${file}`
        );

        if (!summary) {
          console.warn("[WARN] summary.json 読み込み失敗:", file);
          continue;
        }

        // plantingRef は file 名から抽出（揺れゼロ）
        const plantingRef = extractRefFromFile(file);

        const variety = summary?.planting?.variety ?? null;
        const varietyType = varietyTypeMap[variety] ?? null;
        const harvestPlanYM = summary?.planting?.harvestPlanYM ?? null;

        if (!harvestPlanYM) {
          console.warn("[WARN] harvestPlanYM が無い:", file);
          continue;
        }

        const planYear = Number(harvestPlanYM.split("-")[0]);
        if (!result[planYear]) result[planYear] = [];

        result[planYear].push({
          plantingRef,
          variety,
          varietyType,
          harvestPlanYM,
          folder: folderField,
          year,
          file
        });
      }
    }
  }

  result.lastSummaryIndexHash = currentHash;

  if (DEBUG) console.log("[DEBUG] year-index.json:", result);

  return result;
}

export async function saveYearIndex(newIndex) {
  // ★ saveJSON は先頭 / を付けないのが正しい
  await saveJSON("data/year-index.json", newIndex);
}
