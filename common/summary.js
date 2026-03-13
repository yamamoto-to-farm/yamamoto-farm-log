// common/summary.js
// サマリー生成ロジック（フォルダ生成・サマリー生成・一括生成）

/* ---------------------------------------------------------
   1. GitHub 保存ラッパー
--------------------------------------------------------- */
async function saveToGitHub(path, content) {
  const res = await fetch("/api/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content })
  });
  return await res.json();
}

/* ---------------------------------------------------------
   2. summary フォルダの存在保証
--------------------------------------------------------- */
async function summaryEnsureFolders(field, year) {
  const base = `summary/${field}`;
  const yearPath = `${base}/${year}`;

  await saveToGitHub(`${base}/.keep`, "");
  await saveToGitHub(`${yearPath}/.keep`, "");
}

/* ---------------------------------------------------------
   3. CSV 読み込み
--------------------------------------------------------- */
async function loadCsv(path) {
  const res = await fetch(path);
  const text = await res.text();
  return Papa.parse(text, { header: true }).data;
}

/* ---------------------------------------------------------
   4. plantingRef → field/year 抽出（安全版）
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
   5. summaryUpdate(plantingRef)
--------------------------------------------------------- */
async function summaryUpdate(plantingRef) {
  const parsed = parsePlantingRef(plantingRef);
  if (!parsed) return; // 不正データは無視

  const { field, year } = parsed;

  await summaryEnsureFolders(field, year);

  // ★ 正しいパス（logs 配下）
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
    plantDate: p.plantDate, // ★ 修正済み
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
     保存
  ------------------------------ */
  const path = `summary/${field}/${year}/${plantingRef}.json`;
  await saveToGitHub(path, JSON.stringify(summary, null, 2));

  return summary;
}

/* ---------------------------------------------------------
   6. summaryUpdateAll()
--------------------------------------------------------- */
async function summaryUpdateAll() {
  const planting = await loadCsv("../logs/planting/all.csv");

  for (const p of planting) {
    if (!p.plantingRef) continue; // ★ 空行スキップ

    const parsed = parsePlantingRef(p.plantingRef);
    if (!parsed) continue;

    const { field, year } = parsed;

    const path = `../summary/${field}/${year}/${p.plantingRef}.json`;

    // HEAD で静かに存在チェック
    const res = await fetch(path, { method: "HEAD", cache: "no-store" });
    if (res.ok) continue;

    await summaryUpdate(p.plantingRef);
  }
}

/* ---------------------------------------------------------
   7. 公開 API
--------------------------------------------------------- */
window.summaryUpdate = summaryUpdate;
window.summaryUpdateAll = summaryUpdateAll;