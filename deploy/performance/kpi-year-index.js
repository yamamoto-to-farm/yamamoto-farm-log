// kpi-year-index.js
// summary-index.json だけから year-index.json を生成（kpi-month.js と同じ方式）
// ・CSV は使わない
// ・plantingRef は file 名から抽出
// ・safeFileName で揺れ吸収（kpi-month.js と同じ）
// ・summary.json から variety / harvestPlanYM を取得
// ・varieties.json から varietyType を付与

import { loadSummaryIndex, loadSummaryJSON } from "./kpi-data-loader.js";
import { sha256 } from "/common/sha256.js";
import { saveJSON, loadJSON } from "/common/json.js";
import { safeFileName } from "/common/utils.js?v=1.1";

const DEBUG = true;

/* ---------------------------------------------------------
   file 名 → plantingRef（揺れゼロ）
--------------------------------------------------------- */
function extractRef(file) {
  return safeFileName(file.replace(".json", ""));
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

        // plantingRef（揺れゼロ）
        const plantingRef = extractRef(file);

        const planting = summary.planting || {};
        const variety = planting.variety || null;
        const varietyType = varietyTypeMap[variety] || null;
        const harvestPlanYM = planting.harvestPlanYM || null;

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
  // saveJSON は先頭 / を付けない
  await saveJSON("data/year-index.json", newIndex);
}
