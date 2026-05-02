// card-variety-summary.js
import { loadJSON } from "/common/json.js";
import { loadCSV, normalizeKeys } from "/common/csv.js";

/* ===============================
   品種別サマリーカード生成（detail.js から呼ばれる）
=============================== */
export async function renderVarietySummaryCards(varietyName) {

  /* -------------------------
     ★ variety-index.json を読む
  ------------------------- */
  let vIndex = {};
  try {
    vIndex = await loadJSON("/data/variety-index.json");
  } catch {
    return `<p>variety-index.json が読み込めませんでした</p>`;
  }

  const years = vIndex[varietyName];
  if (!years) {
    return `<p>この品種の実績データはありません</p>`;
  }

  /* -------------------------
     ★ seed/all.csv（seedRef の詳細用）
  ------------------------- */
  let seedRows = [];
  try {
    seedRows = normalizeKeys(await loadCSV("/logs/seed/all.csv"));
  } catch {
    console.warn("seed/all.csv が読み込めませんでした");
  }

  let html = "";

  /* -------------------------
     ★ 年ごとのカード生成
  ------------------------- */
  for (const year of Object.keys(years).sort()) {

    const { seed = [], planting = [] } = years[year];

    html += `
      <details class="year-card" open>
        <summary>${year}年の実績</summary>
        <div class="year-content">
    `;

    /* -------------------------
       ★ seedRef のカード
    ------------------------- */
    if (seed.length > 0) {
      html += `<h3>播種（seedRef）</h3>`;

      seed.forEach(ref => {
        const row = seedRows.find(r => r.seedRef === ref);

        if (row) {
          html += `
            <div class="seed-card">
              <div>播種日：${row.seedDate}</div>
              <div>数量：${row.quantity || "-"}</div>
              <div>seedRef：${ref}</div>
            </div>
          `;
        } else {
          html += `<div class="seed-card"><div>seedRef：${ref}</div></div>`;
        }
      });
    }

    /* -------------------------
       ★ plantingRef のカード
    ------------------------- */
    if (planting.length > 0) {
      html += `<h3>定植（plantingRef）</h3>`;

      for (const p of planting) {
        const plantingRef = p.plantingRef;
        const fileName = p.fileName;

        // plantingRef から field / year を抽出
        const [refDate, field] = plantingRef.split("-");
        const y = refDate.substring(0, 4);

        const summaryPath = `/logs/summary/${field}/${y}/${fileName}`;

        let summaryData = null;
        try {
          summaryData = await loadJSON(summaryPath);
        } catch {
          html += `
            <div class="planting-card">
              <div>plantingRef：${plantingRef}</div>
              <div style="color:#c00;">summary.json が見つかりません</div>
            </div>
          `;
          continue;
        }

        html += renderSummaryCard(summaryData);
      }
    }

    html += `</div></details>`;
  }

  return html;
}

/* ===============================
   summary.json → カードHTML
=============================== */
function renderSummaryCard(s) {

  const seedRef = s.planting.seedRef;
  const spacingText = `${s.planting.spacing.row}cm × ${s.planting.spacing.bed}cm`;

  const updatedJST = new Date(s.lastUpdated).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo"
  });

  return `
    <div class="planting-card">
      <div>圃場：${s.field}</div>
      <div>定植日：${s.planting.plantDate}</div>
      <div>定植株数：${s.planting.quantity} 株（${s.planting.trayType || "-"}穴）</div>
      <div>株間 × 条間：${spacingText}</div>
      <div>収穫回数：${s.harvest.count}</div>
      <div>収穫合計：${s.harvest.totalAmount} 基（${s.shipping.totalWeight.toFixed(1)} kg）</div>
      <div>plantingRef：${s.plantingRef}</div>
      <div style="font-size:12px; color:#666;">最終更新：${updatedJST}</div>
    </div>
  `;
}
