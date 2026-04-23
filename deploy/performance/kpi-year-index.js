// kpi-year-index.js
// year-index.json の生成・更新・ハッシュ管理

import { loadSummaryIndex, loadSummaryJSON } from "./kpi-data-loader.js";
import { sha256 } from "/common/sha256.js"; // 既存 or 新規追加

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
  const result = {};
  const currentHash = await computeSummaryIndexHash();

  for (const field in summaryIndex) {
    for (const year in summaryIndex[field]) {
      for (const file of summaryIndex[field][year]) {
        const path = `/logs/summary/${field}/${year}/${file}`;
        const summary = await loadSummaryJSON(path);

        const planYear = Number(summary.planting.harvestPlanYM.split("-")[0]);

        if (!result[planYear]) result[planYear] = [];
        result[planYear].push({
          field,
          year,
          file,
          plantingRef: file.replace(".json", "")
        });
      }
    }
  }

  result.lastSummaryIndexHash = currentHash;
  return result;
}
