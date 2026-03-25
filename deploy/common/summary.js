// =========================================================
// common/summary.js — CloudFront + S3 最適化版（index 自動更新版）
// =========================================================

import { cb, safeFieldName, safeFileName } from "./utils.js?v=2026031418";
import { saveLog } from "./save/index.js?v=2026031418";
import { loadJSON, saveJSON } from "./json.js?v=2026031418";

/* ---------------------------------------------------------
   0. デバッグフラグ
--------------------------------------------------------- */
const SUMMARY_DEBUG = false;
const SUMMARY_DEBUG_BYPASS_CACHE = false;

function dlog(...args) {
  if (SUMMARY_DEBUG) console.log("[summary-debug]", ...args);
}

/* ---------------------------------------------------------
   1. キャッシュ
--------------------------------------------------------- */
let plantingCache = null;
let harvestCache = null;
let shippingCache = null;
let indexCache = null;

/* ---------------------------------------------------------
   2. キャッシュ破棄
--------------------------------------------------------- */
export function invalidateSummaryCache(type) {
  dlog("invalidateSummaryCache:", type);

  if (type === "planting") plantingCache = null;
  if (type === "harvest") harvestCache = null;
  if (type === "weight") shippingCache = null;
  if (type === "index") indexCache = null;

  if (type === "all") {
    plantingCache = null;
    harvestCache = null;
    shippingCache = null;
    indexCache = null;
  }
}

/* ---------------------------------------------------------
   3. CSV 読み込み（CloudFront 絶対パス）
--------------------------------------------------------- */

// CloudFront のベース URL
const CF_BASE = "https://d3sscxnlo0qnhe.cloudfront.net";

async function loadCsvCached(path, cacheVar, type) {
  if (!SUMMARY_DEBUG_BYPASS_CACHE && cacheVar.value) {
    dlog("loadCsvCached: use cache for", type, "rows =", cacheVar.value.length);
    return cacheVar.value;
  }

  const url = `${CF_BASE}/${path}?ts=${Date.now()}`;
  dlog("loadCsvCached: fetch", type, url);

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return [];

  const text = await res.text();
  const data = Papa.parse(text, { header: true }).data;

  cacheVar.value = data;
  return data;
}

async function loadIndexCached() {
  if (indexCache && !SUMMARY_DEBUG_BYPASS_CACHE) return indexCache;

  try {
    // /data/summary-index.json を CloudFront 経由で読む
    const raw = await loadJSON("/data/summary-index.json");

    // CR 除去して安全化
    const cleaned = {};
    for (const key of Object.keys(raw)) {
      cleaned[key.replace(/\r$/, "")] = raw[key];
    }

    indexCache = cleaned;
  } catch (e) {
    console.warn("[summary] loadIndexCached failed, use empty index:", e);
    indexCache = {};
  }

  return indexCache;
}

/* ---------------------------------------------------------
   4. サマリー更新キュー
--------------------------------------------------------- */
window.summaryQueue = [];
let summaryProcessing = false;

export function enqueueSummaryUpdate(plantingRef) {
  if (!plantingRef) return;
  window.summaryQueue.push(plantingRef);
  processSummaryQueue();
}

async function processSummaryQueue() {
  if (summaryProcessing) return;
  summaryProcessing = true;

  while (window.summaryQueue.length > 0) {
    const ref = window.summaryQueue.shift();

    try {
      await summaryUpdate(ref);

      window.dispatchEvent(
        new CustomEvent("summaryGenerated", { detail: { plantingRef: ref } })
      );
    } catch (e) {
      console.error("summaryUpdate failed:", e);
    }

    await new Promise(r => setTimeout(r, 200));
  }

  summaryProcessing = false;
  window.dispatchEvent(new Event("summaryQueueEmpty"));
}

/* ---------------------------------------------------------
   5. summaryUpdate（CloudFront 最新読み込み）
--------------------------------------------------------- */
export async function summaryUpdate(plantingRef) {
  console.log(">>> summaryUpdate START:", plantingRef);

  // CSV が更新された可能性があるのでキャッシュ破棄
  invalidateSummaryCache("harvest");
  invalidateSummaryCache("weight");

  // CloudFront の絶対パスで読み込み
  const planting = await loadCsvCached(
    "logs/planting/all.csv",
    { value: plantingCache },
    "planting"
  );
  const harvest = await loadCsvCached(
    "logs/harvest/all.csv",
    { value: harvestCache },
    "harvest"
  );
  const shipping = await loadCsvCached(
    "logs/weight/all.csv",
    { value: shippingCache },
    "weight"
  );

  const p = planting.find(x => x.plantingRef === plantingRef);
  if (!p) return;

  const harvestRows = harvest.filter(x => x.plantingRef === plantingRef);
  const shippingRows = shipping.filter(x => x.plantingRef === plantingRef);

  const harvestDates = harvestRows
    .map(x => x.harvestDate)
    .filter(Boolean)
    .sort();
  const harvestTotalAmount = harvestRows.reduce(
    (s, x) => s + Number(x.amount || 0),
    0
  );

  const shippingDates = shippingRows
    .map(x => x.shippingDate)
    .filter(Boolean)
    .sort();
  const shippingTotalWeight = shippingRows.reduce(
    (s, x) => s + Number(x.totalWeight || 0),
    0
  );

  const summary = {
    plantingRef,
    planting: {
      plantDate: p.plantDate || "",
      field: p.field || "",
      variety: p.variety || "",
      seedRef: p.seedRef || "",
      quantity: Number(p.quantity || 0),
      trayType: p.trayType ? Number(p.trayType) : null,
      spacing: {
        row: Number(p.spacingRow || 0),
        bed: Number(p.spacingBed || 0)
      },
      harvestPlanYM: p.harvestPlanYM || ""
    },
    harvest: {
      count: harvestRows.length,
      totalAmount: harvestTotalAmount,
      firstDate: harvestDates[0] || null,
      lastDate: harvestDates[harvestDates.length - 1] || null
    },
    shipping: {
      count: shippingRows.length,
      totalWeight: shippingTotalWeight,
      firstDate: shippingDates[0] || null,
      lastDate: shippingDates[shippingDates.length - 1] || null
    },
    lastUpdated: new Date().toISOString()
  };

  /* ------------------------------
     summary-index.json 更新
  ------------------------------ */
  const index = await loadIndexCached();

  const year = p.plantDate?.substring(0, 4) || "unknown";
  const safeField = safeFieldName(p.field || "");
  const safeRef = safeFileName(plantingRef);
  const fileName = `${safeRef}.json`;

  if (!index[safeField]) index[safeField] = {};
  if (!index[safeField][year]) index[safeField][year] = [];

  if (!index[safeField][year].includes(fileName)) {
    index[safeField][year].push(fileName);
  }

  // 並びを安定させたい場合はここでソート
  for (const field of Object.keys(index)) {
    for (const y of Object.keys(index[field])) {
      index[field][y].sort();
    }
  }

  // 1) summary 本体は saveLog で logs/summary に保存
  await saveLog({
    type: "multi",
    files: [
      {
        path: `logs/summary/${safeField}/${year}/${fileName}`,
        content: JSON.stringify(summary, null, 2)
      }
    ]
  });

  // 2) index は saveJSON で /data/summary-index.json に保存
  await saveJSON("data/summary-index.json", index);

  indexCache = index;

  console.log(">>> summaryUpdate END:", plantingRef);
  return summary;
}

/* ---------------------------------------------------------
   6. 公開 API
--------------------------------------------------------- */
window.summaryUpdate = summaryUpdate;
window.enqueueSummaryUpdate = enqueueSummaryUpdate;
window.invalidateSummaryCache = invalidateSummaryCache;