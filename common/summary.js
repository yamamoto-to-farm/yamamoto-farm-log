// common/summary.js
// サマリー生成ロジック（フォルダ生成・サマリー生成・一括生成）

/* ---------------------------------------------------------
   1. GitHub 保存ラッパー（saveLog と同じ Worker を使う前提）
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
      /summary/{field}/{year}/ を自動生成
--------------------------------------------------------- */
async function summaryEnsureFolders(field, year) {
  const base = `summary/${field}`;
  const yearPath = `${base}/${year}`;

  // 圃場フォルダ
  await saveToGitHub(`${base}/.keep`, "");

  // 年フォルダ
  await saveToGitHub(`${yearPath}/.keep`, "");
}

/* ---------------------------------------------------------
   3. CSV 読み込み（既存の loadCsv を使う前提）
--------------------------------------------------------- */
async function loadCsv(path) {
  const res = await fetch(path);
  const text = await res.text();
  return Papa.parse(text, { header: true }).data;
}

/* ---------------------------------------------------------
   4. plantingRef から field / year を抽出
--------------------------------------------------------- */
function parsePlantingRef(plantingRef) {
  // 例: 20250809-三角畑(下)-夏ごろも
  const parts = plantingRef.split("-");
  const date = parts[0];
  const field = parts[1];
  const year = date.substring(0, 4);
  return { field, year };
}

/* ---------------------------------------------------------
   5. summaryUpdate(plantingRef)
      → 1作付けのサマリーを生成して保存
--------------------------------------------------------- */
async function summaryUpdate(plantingRef) {
  const { field, year } = parsePlantingRef(plantingRef);

  // フォルダ生成
  await summaryEnsureFolders(field, year);

  // CSV 読み込み
  const planting = await loadCsv("data/planting/all.csv");
  const harvest = await loadCsv("data/harvest/all.csv");
  const shipping = await loadCsv("data/shipping/all.csv");

  // 対象作付けの抽出
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
    const dates = harvestRows.map(x => x.date).sort();
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
     サマリー JSON 生成
  ------------------------------ */
  const summary = {
    plantingRef,
    field,
    year: Number(year),
    variety: p.variety,
    cropType: p.cropType,
    plantingDate: p.plantingDate,
    seedDate: p.seedDate,
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
    plantCount: Number(p.plantCount || 0),
    spacing: {
      plants: Number(p.plants || 0),
      rows: Number(p.rows || 0)
    },
    cultivationArea: Number(p.area || 0),
    status: p.status || "active",
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
      → サマリーが存在しない作付けだけ生成
--------------------------------------------------------- */
async function summaryUpdateAll() {
  const planting = await loadCsv("data/planting/all.csv");

  for (const p of planting) {
    const { field, year } = parsePlantingRef(p.plantingRef);
    const path = `summary/${field}/${year}/${p.plantingRef}.json`;

    // 既存チェック
    const res = await fetch(path);
    if (res.status === 200) continue;

    // 未生成なら作る
    await summaryUpdate(p.plantingRef);
  }
}

/* ---------------------------------------------------------
   7. 公開 API
--------------------------------------------------------- */
window.summaryUpdate = summaryUpdate;
window.summaryUpdateAll = summaryUpdateAll;