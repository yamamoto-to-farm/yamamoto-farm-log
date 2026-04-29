// kpi-year-index.js
// year-index.json の生成・更新・ハッシュ管理
// ・plantingRef で CSV と summary を紐付け
// ・CSV の field を fields.json.name に突き合わせて area を取得
// ・year-index.json では "field" ではなく "name" を使う

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

  // ▼ 播種・定植 CSV を読み込む（plantingRef で紐付けに使う）
  const plantingRows = normalizeKeys(await loadCSV("/logs/planting/all.csv"));

  // fields.json: name → area
  const fieldAreaMap = Object.fromEntries(
    (fields || []).map(f => [f.name, f.area])
  );

  // varieties.json: variety → type
  const varietyTypeMap = Object.fromEntries(
    (varieties || []).map(v => [v.name, v.type])
  );

  if (DEBUG_YEAR_INDEX) {
    console.log("=== [DEBUG] fields.json ===", fields);
    console.log("=== [DEBUG] fieldAreaMap (name → area) ===", fieldAreaMap);
    console.log("=== [DEBUG] varieties.json ===", varieties);
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

        // plantingRef はファイル名から復元
        const plantingRef = file.replace(".json", "");

        // ▼ CSV 側の行を plantingRef で特定
        const plantingRow = plantingRows.find(r => r.plantingRef === plantingRef);

        // ===============================
        // ★ 圃場名 name の決定
        //   1. CSV の field（最優先）
        //   2. フォルダ名（fallback）
        // ===============================
        const name =
          plantingRow?.field ??
          folderField;

        // ===============================
        // ★ area の決定
        //   1. CSV の field を fields.json.name に突き合わせて area を取得
        //   2. それでも無ければ folderField を name とみなして fields.json から area を取得
        //   3. 最後に null
        // ===============================
        let area = null;

        if (plantingRow?.field && fieldAreaMap[plantingRow.field]) {
          area = fieldAreaMap[plantingRow.field];
        } else if (fieldAreaMap[folderField]) {
          area = fieldAreaMap[folderField];
        } else {
          area = null;
        }

        // ===============================
        // ★ varietyType の決定
        //   varieties.json から補完（なければ null）
        // ===============================
        const varietyType = varietyTypeMap[variety] ?? null;

        if (DEBUG_YEAR_INDEX) {
          console.log("========================================");
          console.log(`[DEBUG] file="${file}" plantingRef="${plantingRef}"`);
          console.log(`[DEBUG] folderField="${folderField}"`);
          console.log(`[DEBUG] CSV plantingRow.field="${plantingRow?.field ?? ""}"`);
          console.log(`[DEBUG] name="${name}" → area="${area}"`);
          console.log(`[DEBUG] variety="${variety}" → varietyType="${varietyType}"`);
        }

        if (!result[planYear]) result[planYear] = [];

        result[planYear].push({
          name,        // ← ここを "field" ではなく "name" に統一
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
