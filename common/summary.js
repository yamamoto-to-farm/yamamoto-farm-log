// summary.js  — 軽量化 + キュー + キャッシュ制御

import { cb, safeFieldName, safeFileName } from "../common/util.js?v=2026031418";
import { saveLog } from "./save/index.js?v=2026031418";

/* ---------------------------------------------------------
   0. サマリー更新キュー（非同期で1件ずつ処理）
--------------------------------------------------------- */
window.summaryQueue = [];
let summaryProcessing = false;

export function enqueueSummaryUpdate(plantingRef) {
    if (!plantingRef) return;
    summaryQueue.push(plantingRef);
    processSummaryQueue();
}

async function processSummaryQueue() {
    if (summaryProcessing) return;
    summaryProcessing = true;

    while (summaryQueue.length > 0) {
        const ref = summaryQueue.shift();
        console.log(">>> summaryQueue processing:", ref);

        try {
            await summaryUpdate(ref);
        } catch (e) {
            console.error(">>> summaryUpdate failed:", e);
        }

        // GitHub の反映遅延を吸収（重要）
        await new Promise(r => setTimeout(r, 300));
    }

    summaryProcessing = false;

    // ★ キューが空になったことを summary-manager に通知
    window.dispatchEvent(new Event("summaryQueueEmpty"));
}

/* ---------------------------------------------------------
   1. CSV / index のキャッシュ
--------------------------------------------------------- */
let plantingCache = null;
let harvestCache = null;
let shippingCache = null;
let indexCache = null;

async function loadCsvCached(path, cacheVar) {
    if (cacheVar.value) return cacheVar.value;

    const res = await fetch(cb(path) + `?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return [];

    const text = await res.text();
    const data = Papa.parse(text, { header: true }).data;

    cacheVar.value = data;
    return data;
}

async function loadIndexCached() {
    if (indexCache) return indexCache;

    try {
        const res = await fetch(cb("../data/summary-index.json") + `?t=${Date.now()}`, {
            cache: "no-store"
        });
        if (!res.ok) return (indexCache = {});
        return (indexCache = await res.json());
    } catch {
        return (indexCache = {});
    }
}

/* ---------------------------------------------------------
   2. summaryUpdate（軽量化版）
--------------------------------------------------------- */
export async function summaryUpdate(plantingRef) {
    console.log(">>> summaryUpdate START:", plantingRef);

    // ---- CSV 読み込み（キャッシュ利用） ----
    const planting = await loadCsvCached("../logs/planting/all.csv", { value: plantingCache });
    const harvest = await loadCsvCached("../logs/harvest/all.csv", { value: harvestCache });
    const shipping = await loadCsvCached("../logs/weight/all.csv", { value: shippingCache });

    const p = planting.find(x => x.plantingRef === plantingRef);
    if (!p) {
        console.warn(">>> plantingRef not found:", plantingRef);
        return;
    }

    const harvestRows = harvest.filter(x => x.plantingRef === plantingRef);
    const shippingRows = shipping.filter(x => x.plantingRef === plantingRef);

    // ---- サマリー生成（軽量化） ----
    const summary = {
        plantingRef,
        variety: p.variety,
        cropType: p.cropType,
        plantDate: p.plantDate,
        seedRef: p.seedRef,
        quantity: Number(p.quantity || 0),
        spacing: {
            row: Number(p.spacingRow || 0),
            bed: Number(p.spacingBed || 0)
        },
        harvest: {
            count: harvestRows.length,
            totalWeight: harvestRows.reduce((s, x) => s + Number(x.weight || 0), 0)
        },
        shipping: {
            count: shippingRows.length,
            totalWeight: shippingRows.reduce((s, x) => s + Number(x.weight || 0), 0)
        },
        lastUpdated: new Date().toISOString()
    };

    // ---- index.json 更新（キャッシュ利用） ----
    const index = await loadIndexCached();

    const year = p.plantDate?.substring(0, 4) || "unknown";
    const safeField = safeFieldName(p.field);
    const safeRef = safeFileName(plantingRef);
    const fileName = `${safeRef}.json`;

    if (!index[safeField]) index[safeField] = {};
    if (!index[safeField][year]) index[safeField][year] = [];

    if (!index[safeField][year].includes(fileName)) {
        index[safeField][year].push(fileName);
    }

    // ---- 保存（軽量・確実） ----
    await saveLog({
        type: "multi",
        files: [
            {
                path: `logs/summary/${safeField}/${year}/${fileName}`,
                content: JSON.stringify(summary, null, 2)
            },
            {
                path: "data/summary-index.json",
                content: JSON.stringify(index, null, 2)
            }
        ]
    });

    console.log(">>> summaryUpdate END:", plantingRef);
    return summary;
}

/* ---------------------------------------------------------
   3. 公開 API
--------------------------------------------------------- */
window.summaryUpdate = summaryUpdate;
window.enqueueSummaryUpdate = enqueueSummaryUpdate;