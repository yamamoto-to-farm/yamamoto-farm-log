// kpi-year-index.js
// CSV（planting/all.csv）を唯一の正として year-index.json を生成する完全版
// ・summary-index.json は folder/year/file の補完にのみ使用
// ・summary.json は plantingRef の揺れ吸収には使わない
// ・normalizeKeys + normalizeRef + safeFileName で plantingRef を完全統一
// ・month-kpi と harvest-kpi の実績が完全一致する

import { loadSummaryIndex } from "./kpi-data-loader.js";
import { sha256 } from "/common/sha256.js";
import { saveJSON, loadJSON } from "/common/json.js";
import { loadCSV, normalizeKeys } from "/common/csv.js";
import { safeFileName } from "/common/utils.js?v=1.1";

const DEBUG = true;

/* ---------------------------------------------------------
   plantingRef の揺れ吸収（最強版）
--------------------------------------------------------- */
function normalizeRef(ref) {
  if (!ref) return "";
  return ref
    .replace(/[()（）]/g, "")
    .replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
    .replace(/[‐‑‒–—―]/g, "-")     // ハイフン統一
    .replace(/[＿﹍﹎ˍ]/g, "_")     // アンダーバー統一
    .replace(/\s+/g, "")
    .replace(/\u200B/g, "")         // ゼロ幅スペース除去
    .trim();
}

/* ---------------------------------------------------------
   summary-index.json のハッシュ
--------------------------------------------------------- */
export async function computeSummaryIndexHash() {
  const summaryIndex = await loadSummaryIndex();
  return sha256(JSON.stringify(summaryIndex));
}

export async function checkYearIndexNeedsUpdate(yearIndex) {
  const currentHash = await computeSummaryIndexHash();
  return yearIndex.lastSummaryIndexHash !== currentHash;
}

/* ---------------------------------------------------------
   year-index.json 生成（CSV 方式・欠落ゼロ）
--------------------------------------------------------- */
export async function generateYearIndex() {
  // ★ カラム名を normalizeKeys で揃える（最重要）
  const plantingRows = normalizeKeys(
    await loadCSV("/logs/planting/all.csv")
  );

  const varieties = await loadJSON("/data/varieties.json");
  const summaryIndex = await loadSummaryIndex();

  const varietyTypeMap = Object.fromEntries(
    varieties.map(v => [v.name, v.type])
  );

  const result = {};
  const currentHash = await computeSummaryIndexHash();

  for (const row of plantingRows) {
    const rawRef = row.plantingRef;

    // ★ 空欄・undefined の ref を完全除外（ズレの原因を潰す）
    if (!rawRef || rawRef.trim() === "") {
      console.warn("[WARN] plantingRef が空の行を除外:", row);
      continue;
    }

    const normRef = normalizeRef(rawRef);
    const ref = safeFileName(normRef);

    const variety = row.variety || null;
    const varietyType = varietyTypeMap[variety] || null;
    const harvestPlanYM = row.harvestPlanYM || null;

    if (!harvestPlanYM) {
      console.warn("[WARN] harvestPlanYM が無い:", rawRef);
      continue;
    }

    const planYear = Number(harvestPlanYM.split("-")[0]);
    if (!result[planYear]) result[planYear] = [];

    // ▼ summary-index から folder/year/file を探す（無くても OK）
    let folder = null;
    let year = null;
    let file = null;

    outer:
    for (const fld in summaryIndex) {
      for (const y in summaryIndex[fld]) {
        for (const f of summaryIndex[fld][y]) {
          const fRef = safeFileName(normalizeRef(f.replace(".json", "")));
          if (fRef === ref) {
            folder = fld;
            year = y;
            file = f;
            break outer;
          }
        }
      }
    }

    if (!folder) {
      console.warn("[WARN] summary-index に無い ref:", rawRef);
    }

    result[planYear].push({
      plantingRef: rawRef,
      normalizedRef: ref,
      variety,
      varietyType,
      harvestPlanYM,
      folder,
      year,
      file
    });
  }

  result.lastSummaryIndexHash = currentHash;

  if (DEBUG) console.log("[DEBUG] year-index.json:", result);

  return result;
}

/* ---------------------------------------------------------
   保存（先頭 / は付けない）
--------------------------------------------------------- */
export async function saveYearIndex(newIndex) {
  await saveJSON("data/year-index.json", newIndex);
}
