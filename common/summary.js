// common/summary.js — サマリー構造を最適化（planting / harvest / shipping）
// 収穫基数・開始/終了日、出荷開始/終了日、harvestPlanYM を反映

import { cb, safeFieldName, safeFileName } from "./utils.js?v=2026031418";
import { saveLog } from "./save/index.js?v=2026031418";

/* ---------------------------------------------------------
   0. サマリー更新キュー
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

        try {
            const summary = await summaryUpdate(ref);

            // ★ 個別生成のときだけ詳細通知
            if (!window._bulkSummaryList) {
                alert(
                    `サマリーを生成しました\n\n` +
                    `【定植】\n` +
                    `plantingRef: ${summary.plantingRef}\n` +
                    `品種: ${summary.planting.variety}\n` +
                    `定植日: ${summary.planting.plantDate}\n` +
                    `収穫予定: ${summary.planting.harvestPlanYM}\n\n` +
                    `【収穫】\n` +
                    `回数: ${summary.harvest.count}\n` +
                    `基数合計: ${summary.harvest.totalAmount}\n` +
                    `開始: ${summary.harvest.firstDate || "-"}\n` +
                    `最新: ${summary.harvest.lastDate || "-"}\n\n` +
                    `【出荷】\n` +
                    `回数: ${summary.shipping.count}\n` +
                    `重量合計: ${summary.shipping.totalWeight} kg\n` +
                    `開始: ${summary.shipping.firstDate || "-"}\n` +
                    `最新: ${summary.shipping.lastDate || "-"}`
                );
            }

            // ★ UI に即時反映させるためのイベント
            window.dispatchEvent(
                new CustomEvent("summaryGenerated", {
                    detail: { plantingRef: ref }
                })
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
   1. CSV / index のキャッシュ
--------------------------------------------------------- */
let plantingCache = null;
let harvestCache = null;
let shippingCache = null;
let indexCache = null;

async function loadCsvCached(path, cacheVar) {
    if (cacheVar.value) return cacheVar.value;

    const res = await fetch(cb(path), { cache: "no-store" });
    if (!res.ok) return [];

    const text = await res.text();
    const data = Papa.parse(text, { header: true }).data;

    cacheVar.value = data;
    return data;
}

async function loadIndexCached() {
    if (indexCache) return indexCache;

    try {
        const res = await fetch(cb("../data/summary-index.json"), {
            cache: "no-store"
        });
        if (!res.ok) return (indexCache = {});
        return (indexCache = await res.json());
    } catch {
        return (indexCache = {});
    }
}

/* ---------------------------------------------------------
   2. summaryUpdate（サマリー構造を最適化）
--------------------------------------------------------- */
export async function summaryUpdate(plantingRef) {
    console.log(">>> summaryUpdate START:", plantingRef);

    const planting = await loadCsvCached("../logs/planting/all.csv", { value: plantingCache });
    const harvest = await loadCsvCached("../logs/harvest/all.csv", { value: harvestCache });
    const shipping = await loadCsvCached("../logs/weight/all.csv", { value: shippingCache });

    const p = planting.find(x => x.plantingRef === plantingRef);
    if (!p) return;

    const harvestRows = harvest.filter(x => x.plantingRef === plantingRef);
    const shippingRows = shipping.filter(x => x.plantingRef === plantingRef);

    /* ------------------------------
       収穫（harvest）
    ------------------------------ */
    const harvestDates = harvestRows.map(x => x.harvestDate).filter(Boolean).sort();
    const harvestTotalAmount = harvestRows.reduce((s, x) => s + Number(x.amount || 0), 0);

    /* ------------------------------
       出荷（shipping）
    ------------------------------ */
    const shippingDates = shippingRows.map(x => x.shippingDate).filter(Boolean).sort();
    const shippingTotalWeight = shippingRows.reduce((s, x) => s + Number(x.totalWeight || 0), 0);

    /* ------------------------------
       サマリー構造（最終形）
    ------------------------------ */
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

    indexCache = index;
    window.indexCache = index;

    console.log(">>> summaryUpdate END:", plantingRef);
    return summary;
}

/* ---------------------------------------------------------
   3. 公開 API
--------------------------------------------------------- */
window.summaryUpdate = summaryUpdate;
window.enqueueSummaryUpdate = enqueueSummaryUpdate;