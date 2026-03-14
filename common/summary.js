// common/summary.js
// サマリー生成ロジック（logs/summary/ に保存）

import { cb, safeFieldName, safeFileName } from "./utils.js?v=2026031418";

/* ---------------------------------------------------------
   1. Cloudflare Workers 経由で GitHub Actions を起動
--------------------------------------------------------- */
async function saveToGitHub(path, content) {
  const payload = {
    type: "summary",
    dateStr: path,
    json: content,
    csv: "",
    replaceCsv: ""
  };

  const res = await fetch(
    "https://raspy-poetry-cf6f.yamamoto-to-farm.workers.dev",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }
  );

  if (!res.ok) {
    throw new Error("サマリー保存サーバーへの送信に失敗");
  }
}

/* ---------------------------------------------------------
   2. CSV 読み込み（404 → 空配列）
--------------------------------------------------------- */
async function loadCsv(path) {
  const res = await fetch(cb(path));
  if (!res.ok) return [];
  const text = await res.text();
  return Papa.parse(text, { header: true }).data;
}

/* ---------------------------------------------------------
   3. plantingRef → field/year 抽出
--------------------------------------------------------- */
function parsePlantingRef(plantingRef) {
  if (!plantingRef || typeof plantingRef !== "string") return null;

  const parts = plantingRef.split("-");
  if (parts.length < 2) return null;

  const date = parts[0];
  const field = parts[1];
  const year = date.substring(0, 4);

  if (!field || !year) return null;

  return { field, year };
}

/* ---------------------------------------------------------
   4. summaryUpdate(plantingRef)
--------------------------------------------------------- */
async function summaryUpdate(plantingRef) {
  const parsed = parsePlantingRef(plantingRef);
  if (!parsed) return;

  const { field, year } = parsed;

  const safeField = safeFieldName(field);
  const safeRef = safeFileName(plantingRef);

  // logs 配下の CSV を読む
  const planting = await loadCsv("../logs/planting/all.csv");
  const harvest = await loadCsv("../logs/harvest/all.csv");
  const shipping = await loadCsv("../logs/shipping/all.csv");

  const p = planting.find(x => x.plantingRef === plantingRef);
  if (!p) return;

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
     出荷集計
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

  /* ------------------------------
     保存（logs/summary/<safeField>/<year>/<safeRef>.json）
  ------------------------------ */
  const path = `logs/summary/${safeField}/${year}/${safeRef}.json`;
  await saveToGitHub(path, JSON.stringify(summary, null, 2));

  return summary;
}

/* ---------------------------------------------------------
   5. summaryUpdateAll()
--------------------------------------------------------- */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function summaryUpdateAll() {
  const planting = await loadCsv("../logs/planting/all.csv");

  for (const p of planting) {
    if (!p.plantingRef) continue;

    const parsed = parsePlantingRef(p.plantingRef);
    if (!parsed) continue;

    const { field, year } = parsed;

    const safeField = safeFieldName(field);
    const safeRef = safeFileName(p.plantingRef);

    const path = `../logs/summary/${safeField}/${year}/${safeRef}.json`;

    const res = await fetch(cb(path), { method: "HEAD", cache: "no-store" });
    if (res.ok) continue;

    await summaryUpdate(p.plantingRef);
    await sleep(1200);
  }
}

/* ---------------------------------------------------------
   6. 公開 API（OS 全体の window 方式に統一）
--------------------------------------------------------- */
window.summaryUpdate = summaryUpdate;
window.summaryUpdateAll = summaryUpdateAll;