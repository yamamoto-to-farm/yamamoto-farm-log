// common/summary.js
// サマリー生成ロジック（logs/summary/ に保存）

import { cb, safeFieldName, safeFileName } from "./utils.js?v=2026031418";
import { saveLog } from "./save/index.js?v=2026031418";

/* ---------------------------------------------------------
   1. summary-index.json を読み込み
--------------------------------------------------------- */
async function loadIndex() {
    try {
        const res = await fetch(cb("../data/summary-index.json"));
        if (!res.ok) return {};
        const json = await res.json();
        console.log(">>> loadIndex OK:", json);
        return json;
    } catch (e) {
        console.warn(">>> loadIndex ERROR:", e);
        return {};
    }
}

/* ---------------------------------------------------------
   3. CSV 読み込み（404 → 空配列）
--------------------------------------------------------- */
async function loadCsv(path) {
    console.log(">>> loadCsv:", path);

    if (path.includes("weight/all.csv")) {
        try {
            const check = await fetch(cb(path), {
                method: "HEAD",
                redirect: "manual",
                cache: "no-store"
            });

            if (!check.ok) {
                console.log(">>> weight/all.csv NOT FOUND → []");
                return [];
            }
        } catch {
            console.log(">>> weight/all.csv HEAD ERROR → []");
            return [];
        }
    }

    const res = await fetch(cb(path));
    if (!res.ok) return [];
    const text = await res.text();
    return Papa.parse(text, { header: true }).data;
}

/* ---------------------------------------------------------
   4. plantingRef → field/year 抽出
--------------------------------------------------------- */
function parsePlantingRef(plantingRef) {
    console.log(">>> parsePlantingRef:", plantingRef);

    if (!plantingRef || typeof plantingRef !== "string") return null;

    const parts = plantingRef.split("-");
    if (parts.length < 2) return null;

    const date = parts[0];
    const field = parts[1];
    const year = date.substring(0, 4);

    console.log(">>> parsed:", { field, year });

    if (!field || !year) return null;

    return { field, year };
}

/* ---------------------------------------------------------
   5. summaryUpdate(plantingRef, options)
   options:
     - skipSave: true のとき saveLog しない（summaryUpdateAll 用）
     - index: 共有 index オブジェクト（あればそれを使う）
--------------------------------------------------------- */
async function summaryUpdate(plantingRef, options = {}) {
    const { skipSave = false, index: externalIndex = null } = options;

    console.log("==============================================");
    console.log(">>> summaryUpdate START:", plantingRef);

    const parsed = parsePlantingRef(plantingRef);
    if (!parsed) {
        console.warn(">>> parsePlantingRef FAILED");
        return;
    }

    const { field, year } = parsed;

    const safeField = safeFieldName(field);
    const safeRef = safeFileName(plantingRef);

    console.log(">>> field =", field);
    console.log(">>> safeField =", safeField);
    console.log(">>> safeRef =", safeRef);

    // logs 配下の CSV を読む
    const planting = await loadCsv("../logs/planting/all.csv");
    const harvest = await loadCsv("../logs/harvest/all.csv");
    const shipping = await loadCsv("../logs/weight/all.csv");

    const p = planting.find(x => x.plantingRef === plantingRef);
    console.log(">>> p =", p);

    if (!p) {
        console.warn(">>> p NOT FOUND → summaryUpdate STOP");
        return;
    }

    const harvestRows = harvest.filter(x => x.plantingRef === plantingRef);
    const shippingRows = shipping.filter(x => x.plantingRef === plantingRef);

    /* ------------------------------
       収穫集計
    ------------------------------ */
    let harvestStart = null;
    let harvestEnd = null;
    let harvestCount = harvestRows.length;
    let harvestTotal = 0;

    if (harvestRows.length > 0) {
        const dates = harvestRows.map(x => x.date).filter(Boolean).sort();
        harvestStart = dates[0];
        harvestEnd = dates[dates.length - 1];
        harvestTotal = harvestRows.reduce((sum, x) => sum + Number(x.weight || 0), 0);
    }

    /* ------------------------------
       出荷集計（weight）
    ------------------------------ */
    let shippingCount = shippingRows.length;
    let shippingTotal = shippingRows.reduce((sum, x) => sum + Number(x.weight || 0), 0);

    /* ------------------------------
       歩留まり
    ------------------------------ */
    let yieldRate = harvestTotal > 0 ? shippingTotal / harvestTotal : null;

    /* ------------------------------
       サマリー JSON
    ------------------------------ */
    const summary = {
        plantingRef,
        field,
        year: Number(year),
        variety: p.variety,
        cropType: p.cropType,
        plantDate: p.plantDate,
        seedRef: p.seedRef,
        harvest: {
            start: harvestStart,
            end: harvestEnd,
            count: harvestCount,
            totalWeight: harvestTotal
        },
        shipping: {
            count: shippingCount,
            totalWeight: shippingTotal
        },
        yieldRate,
        quantity: Number(p.quantity || 0),
        spacing: {
            row: Number(p.spacingRow || 0),
            bed: Number(p.spacingBed || 0)
        },
        notes: p.notes || "",
        lastUpdated: new Date().toISOString()
    };

    console.log(">>> summary JSON:", summary);

    /* ------------------------------
       index.json を更新
    ------------------------------ */
    let index = externalIndex;
    if (!index) {
        index = await loadIndex();
    }

    console.log(">>> index BEFORE UPDATE:", JSON.stringify(index, null, 2));

    if (!index[safeField]) index[safeField] = {};
    if (!index[safeField][year]) index[safeField][year] = [];

    const fileName = `${safeRef}.json`;

    console.log(">>> fileName =", fileName);
    console.log(">>> exists =", index[safeField][year].includes(fileName));

    if (!index[safeField][year].includes(fileName)) {
        index[safeField][year].push(fileName);
    }

    console.log(">>> index AFTER UPDATE:", JSON.stringify(index, null, 2));

    const summaryPath = `logs/summary/${safeField}/${year}/${safeRef}.json`;

    // skipSave のときは保存せず、summary と index を返す（summaryUpdateAll 用）
    if (skipSave) {
        console.log(">>> summaryUpdate SKIP SAVE (batch mode)");
        console.log("==============================================");
        return { summary, index, summaryPath };
    }

    /* ------------------------------
       ★ 通常モード：multi-saveLog で一括保存 ★
    ------------------------------ */
    await saveLog({
        type: "multi",
        files: [
            {
                path: summaryPath,
                content: JSON.stringify(summary, null, 2)
            },
            {
                path: "data/summary-index.json",
                content: JSON.stringify(index, null, 2)
            }
        ]
    });

    console.log(">>> summaryUpdate END");
    console.log("==============================================");

    return summary;
}

/* ---------------------------------------------------------
   6. summaryUpdateAll()  ← 20件ずつ分割保存
--------------------------------------------------------- */
async function summaryUpdateAll() {
    console.log(">>> summaryUpdateAll START");

    const planting = await loadCsv("../logs/planting/all.csv");
    const index = await loadIndex();

    const files = [];

    for (const p of planting) {
        if (!p.plantingRef) continue;

        const parsed = parsePlantingRef(p.plantingRef);
        if (!parsed) continue;

        const { field, year } = parsed;

        const safeField = safeFieldName(field);
        const safeRef = safeFileName(p.plantingRef);
        const fileName = `${safeRef}.json`;

        console.log(">>> check:", safeField, year, fileName);

        // 既に存在するならスキップ
        if (
            index[safeField] &&
            index[safeField][year] &&
            index[safeField][year].includes(fileName)
        ) {
            console.log(">>> SKIP:", fileName);
            continue;
        }

        // 保存せず summary と path を取得（index は参照渡しで更新される）
        const result = await summaryUpdate(p.plantingRef, {
            skipSave: true,
            index
        });
        if (!result) continue;

        const { summary, summaryPath } = result;

        files.push({
            path: summaryPath,
            content: JSON.stringify(summary, null, 2)
        });
    }

    // 最後に index.json を追加
    files.push({
        path: "data/summary-index.json",
        content: JSON.stringify(index, null, 2)
    });

    /* ------------------------------
       ★ 20件ずつ分割して保存
    ------------------------------ */
    const batchSize = 20;

    for (let i = 0; i < files.length; i += batchSize) {
        const chunk = files.slice(i, i + batchSize);

        console.log(`>>> Saving batch ${i / batchSize + 1}`);

        await saveLog({
            type: "multi",
            files: chunk
        });
    }

    console.log(">>> summaryUpdateAll END");
}

/* ---------------------------------------------------------
   7. 公開 API
--------------------------------------------------------- */
window.summaryUpdate = summaryUpdate;
window.summaryUpdateAll = summaryUpdateAll;