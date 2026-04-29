// kpi-year-index.js
// year-index.json の生成・更新・ハッシュ管理（CSV 補完対応 + name 統一 + デバッグ付き）

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

  // ▼ CSV を読み込んで field → area / type を補完する
  const plantingRows = normalizeKeys(await loadCSV("/logs/planting/all.csv"));

  // CSV の field → area
  const csvFieldAreaMap = {};
  plantingRows.forEach(r => {
    if (r.field && r.area) {
      csvFieldAreaMap[r.field] = r.area;
    }
  });

  // CSV の field → 正規化された field 名（name）
  const csvFieldNameMap = {};
  plantingRows.forEach(r => {
    if (r.field) {
      csvFieldNameMap[r.field] = r.field; // CSV の field をそのまま name とする
    }
  });

  // CSV の variety → type
  const csvVarietyTypeMap = {};
  plantingRows.forEach(r => {
    if (r.variety && r.type) {
      csvVarietyTypeMap[r.variety] = r.type;
    }
  });

  if (DEBUG_YEAR_INDEX) {
    console.log("=== [DEBUG] CSV field → area ===", csvFieldAreaMap);
    console.log("=== [DEBUG] CSV field → name ===", csvFieldNameMap);
    console.log("=== [DEBUG] CSV variety → type ===", csvVarietyTypeMap);
  }

  // ▼ fields.json の補完マップ
  const fieldAreaMap = Object.fromEntries(
    (fields || []).map(f => [f.name, f.area])
  );

  // ▼ varieties.json の補完マップ
  const varietyTypeMap = Object.fromEntries(
    (varieties || []).map(v => [v.name, v.type])
  );

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

        /* ============================================================
           ★ 圃場名（name）補完ロジック
           1. CSV の field を最優先
           2. fields.json の name を次に使う
           3. 最後にフォルダ名を fallback として使う
        ============================================================ */
        const name =
          csvFieldNameMap[folderField] ??
          folderField;

        /* ============================================================
           ★ area 補完ロジック
           1. CSV の area を最優先
           2. fields.json の area を次に使う
           3. 最後に null
        ============================================================ */
        const area =
          csvFieldAreaMap[name] ??
          fieldAreaMap[name] ??
          null;

        /* ============================================================
           ★ varietyType 補完ロジック
           1. CSV の type を最優先
           2. varieties.json の type を次に使う
           3. 最後に null
        ============================================================ */
        const varietyType =
          csvVarietyTypeMap[variety] ??
          varietyTypeMap[variety] ??
          null;

        if (DEBUG_YEAR_INDEX) {
          console.log(`[DEBUG] folderField="${folderField}" → name="${name}"`);
          console.log(`[DEBUG] name="${name}" → area="${area}"`);
          console.log(`[DEBUG] variety="${variety}" → varietyType="${varietyType}"`);
        }

        const plantingRef = file.replace(".json", "");

        if (!result[planYear]) result[planYear] = [];

        result[planYear].push({
          name,          // ← field ではなく name に統一
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
