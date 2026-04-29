// kpi-year-index.js
// year-index.json の生成・更新・ハッシュ管理
// ・logs/planting/all.csv の field 列と fields.json.name を突き合わせて area を決定
// ・year-index.json では "name" を圃場名として使う

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

  // ▼ 播種・定植 CSV を読み込む
  const plantingRows = normalizeKeys(await loadCSV("/logs/planting/all.csv"));

  // CSV に実際に出てくる圃場名だけを対象にする
  const csvFieldSet = new Set(
    plantingRows
      .map(r => r.field)
      .filter(f => !!f)
  );

  // fields.json.name と CSV の field を突き合わせて area を決定
  const fieldAreaMap = {};
  (fields || []).forEach(f => {
    if (csvFieldSet.has(f.name)) {
      fieldAreaMap[f.name] = f.area;
    }
  });

  // varieties.json: variety → type
  const varietyTypeMap = Object.fromEntries(
    (varieties || []).map(v => [v.name, v.type])
  );

  if (DEBUG_YEAR_INDEX) {
    console.log("=== [DEBUG] csvFieldSet ===", Array.from(csvFieldSet));
    console.log("=== [DEBUG] fieldAreaMap (from CSV field × fields.json.name) ===", fieldAreaMap);
    console.log("=== [DEBUG] varietyTypeMap ===", varietyTypeMap);
  }

  const result = {};
  const currentHash = await computeSummaryIndexHash();

  for (const folderField in summaryIndex) {
    for (const year in summaryIndex[folderField]) {
      for (const file of summaryIndex[folderField][year]) {

        const path = `/logs/summary/${folderField}/${year}/${file}`;
        const summary = await loadSummaryJSON(path);

        const planting = summary?.planting ?? {};
        const planYM = planting.harvestPlanYM ?? "";
        const planYear = Number(planYM.split("-")[0]);

        const variety = planting.variety ?? "";

        // plantingRef は一応保持（今後のため）
        const plantingRef = planting.plantingRef ?? file.replace(".json", "");

        // ===============================
        // ★ 圃場名 name の決定
        //   1. summary.planting.field（あれば）
        //   2. フォルダ名（fallback）
        // ===============================
        const name =
          planting.field ??
          folderField;

        // ===============================
        // ★ area の決定
        //   CSV の field と fields.json.name を突き合わせて作った fieldAreaMap から取得
        //   （あなたの前提では、ここは null にならない）
        // ===============================
        const area = fieldAreaMap[name] ?? null;

        // ===============================
        // ★ varietyType の決定
        // ===============================
        const varietyType = varietyTypeMap[variety] ?? null;

        if (DEBUG_YEAR_INDEX) {
          console.log("========================================");
          console.log(`[DEBUG] file="${file}" plantingRef="${plantingRef}"`);
          console.log(`[DEBUG] folderField="${folderField}"`);
          console.log(`[DEBUG] summary.planting.field="${planting.field ?? ""}"`);
          console.log(`[DEBUG] name="${name}" → area="${area}"`);
          console.log(`[DEBUG] variety="${variety}" → varietyType="${varietyType}"`);
        }

        if (!result[planYear]) result[planYear] = [];

        result[planYear].push({
          name,        // 圃場名（CSV / summary ベース）
          area,        // エリア名（CSV field × fields.json.name から取得）
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
