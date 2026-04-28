// kpi-year-index.js
// year-index.json の生成・更新・ハッシュ管理（area / varietyType 対応）

import { loadSummaryIndex, loadSummaryJSON } from "./kpi-data-loader.js";
import { sha256 } from "/common/sha256.js";
import { saveJSON, loadJSON } from "/common/json.js";

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

  // ▼ field → area マップ
  const fieldMap = Object.fromEntries(
    fields.map(f => [f.name, f.area])
  );

  // ▼ variety → type マップ
  const varietyMap = Object.fromEntries(
    varieties.map(v => [v.name, v.type])
  );

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
        const area = fieldMap[field] ?? "";
        const varietyType = varietyMap[variety] ?? "";

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
  return result;
}

/* ===============================
   year-index.json を保存（saveJSON 方式）
=============================== */
export async function saveYearIndex(newIndex) {
  await saveJSON("data/year-index.json", newIndex);
}
