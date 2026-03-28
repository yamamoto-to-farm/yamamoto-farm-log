// =========================================================
// common/summary.js — CloudFront + S3 最適化版（index 自動更新版）
// =========================================================

import { cb, safeFieldName, safeFileName } from "./utils.js?v=2026031418";
import { saveLog } from "./save/index.js?v=2026031418";
import { loadJSON, saveJSON } from "./json.js?v=2026031418";

// ★ 追加：汎用保存モーダル
import { showSaveModal, updateSaveModal, completeSaveModal }
  from "./save-modal.js?v=2026031418";

/* ---------------------------------------------------------
   0. デバッグフラグ
--------------------------------------------------------- */
const SUMMARY_DEBUG = true;

function slog(...args) {
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
  slog("invalidateSummaryCache:", type);

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
   3. CSV 読み込み
--------------------------------------------------------- */

const S3_BASE = "https://yamamoto-farm-log.s3.ap-northeast-1.amazonaws.com";

async function loadCsvNoCache(path, type) {
  const url = `${S3_BASE}/${path}?ts=${Date.now()}&r=${Math.random()}`;
  slog("FETCH:", type, url);

  const res = await fetch(url, {
    cache: "no-store",
    headers: {
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Pragma": "no-cache",
      "Expires": "0"
    }
  });

  if (!res.ok) {
    slog("FETCH FAILED:", type, res.status);
    return [];
  }

  const text = await res.text();

  const data = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: true,
    transformHeader: h => h.trim(),
    transform: v => (typeof v === "string" ? v.trim() : v)
  }).data;

  slog("CSV PARSED:", type, data.length, "rows");
  return data;
}

async function loadIndexCached() {
  if (indexCache) return indexCache;

  try {
    const raw = await loadJSON("/data/summary-index.json");

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

// ★ サマリー更新中フラグ（多重表示防止）
window._summaryUpdating = window._summaryUpdating || false;

// ★ summary を一時保存するプール
window._summaryPool = window._summaryPool || {};

export function enqueueSummaryUpdate(plantingRef) {
  if (!plantingRef) return;
  slog("enqueue:", plantingRef);
  window.summaryQueue.push(plantingRef);
  processSummaryQueue();
}

async function processSummaryQueue() {
  if (summaryProcessing) return;
  summaryProcessing = true;

  // ★ サマリー更新開始（alert → モーダル）
  if (!window._summaryUpdating) {
    window._summaryUpdating = true;
    showSaveModal("サマリーを更新しています…");
  }

  slog("QUEUE START:", window.summaryQueue);

  while (window.summaryQueue.length > 0) {
    const ref = window.summaryQueue.shift();
    slog("PROCESS:", ref);

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
  slog("QUEUE END");

  window.dispatchEvent(new Event("summaryQueueEmpty"));
}

/* ---------------------------------------------------------
   5. summaryUpdate
--------------------------------------------------------- */
export async function summaryUpdate(plantingRef) {
  slog(">>> summaryUpdate START:", plantingRef);

  invalidateSummaryCache("harvest");
  invalidateSummaryCache("weight");

  const planting = await loadCsvNoCache("logs/planting/all.csv", "planting");
  const harvest = await loadCsvNoCache("logs/harvest/all.csv", "harvest");
  const shipping = await loadCsvNoCache("logs/weight/all.csv", "weight");

  const p = planting.find(x => x.plantingRef === plantingRef);
  slog("planting match:", p);

  if (!p) {
    slog("NO planting found → END");
    return;
  }

  const harvestRows = harvest.filter(x => x.plantingRef === plantingRef);
  const shippingRows = shipping.filter(x => x.plantingRef === plantingRef);

  const harvestDates = harvestRows.map(x => x.harvestDate).filter(Boolean).sort();
  const shippingDates = shippingRows.map(x => x.shippingDate).filter(Boolean).sort();

  const harvestTotalAmount = harvestRows.reduce((s, x) => s + Number(x.amount || 0), 0);
  const shippingTotalWeight = shippingRows.reduce((s, x) => s + Number(x.totalWeight || 0), 0);

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

  window._summaryPool[plantingRef] = summary;

  slog(">>> summaryUpdate END:", plantingRef);
  return summary;
}

/* ---------------------------------------------------------
   5.5 summary-index.json を含めてまとめて保存
--------------------------------------------------------- */
export async function flushSummaryPool() {
  slog("=== FLUSH SUMMARY POOL START ===");

  const index = await loadIndexCached();

  for (const plantingRef of Object.keys(window._summaryPool)) {
    const summary = window._summaryPool[plantingRef];

    const safeField = safeFieldName(summary.planting.field);
    const year = summary.planting.plantDate.substring(0, 4) || "unknown";
    const fileName = `${safeFileName(plantingRef)}.json`;

    if (!index[safeField]) index[safeField] = {};
    if (!index[safeField][year]) index[safeField][year] = [];
    if (!index[safeField][year].includes(fileName)) {
      index[safeField][year].push(fileName);
      index[safeField][year].sort();
    }

    await saveLog({
      type: "multi",
      files: [
        {
          path: `logs/summary/${safeField}/${year}/${fileName}`,
          content: JSON.stringify(summary, null, 2)
        }
      ]
    });
  }

  await saveJSON("data/summary-index.json", index);
  indexCache = index;

  slog("=== FLUSH SUMMARY POOL END ===");

  window._summaryPool = {};

  // ★ サマリー更新完了（alert → モーダル）
  if (window._summaryUpdating) {
    window._summaryUpdating = false;
    completeSaveModal("サマリーの更新が完了しました");
  }
}

/* ---------------------------------------------------------
   6. 公開 API
--------------------------------------------------------- */
window.summaryUpdate = summaryUpdate;
window.enqueueSummaryUpdate = enqueueSummaryUpdate;
window.invalidateSummaryCache = invalidateSummaryCache;
window.flushSummaryPool = flushSummaryPool;

if (!window._summaryQueueListenerAdded) {
  window._summaryQueueListenerAdded = true;

  window.addEventListener("summaryQueueEmpty", () => {
    window.flushSummaryPool();
  });

  slog("summaryQueueEmpty listener registered");
}