// card-variety-summary.js
import { loadJSON } from "/common/json.js";
import { loadCSV, normalizeKeys } from "/common/csv.js";

/* ===============================
   品種別サマリーカード生成（detail.js から呼ばれる）
   ★ 圃場詳細と完全一致のUI構造
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
     ★ 年ごとのカード生成（details を廃止）
  ------------------------- */
  for (const year of Object.keys(years).sort()) {

    const { seed = [], planting = [] } = years[year];

    // 年見出し（圃場と同じ）
    html += `<h2 class="section-title">${year}年の実績</h2>`;

    /* -------------------------
       ★ 播種（seedRef）カード
    ------------------------- */
    if (seed.length > 0) {
      html += `<div class="card"><h3>播種（seedRef）</h3>`;

      seed.forEach(ref => {
        const row = seedRows.find(r => r.seedRef === ref);

        if (row) {
          html += `
            <div class="seed-card">
              <div class="info-line">播種日：${row.seedDate}</div>
              <div class="info-line">数量：${row.quantity || "-"}</div>
              <div class="info-line">seedRef：${ref}</div>
            </div>
          `;
        } else {
          html += `
            <div class="seed-card">
              <div class="info-line">seedRef：${ref}</div>
            </div>
          `;
        }
      });

      html += `</div>`; // card end
    }

    /* -------------------------
       ★ 定植（plantingRef）カード
    ------------------------- */
    if (planting.length > 0) {
      html += `<div class="card"><h3>定植（plantingRef）</h3>`;

      for (const p of planting) {
        const plantingRef = p.plantingRef;
        const fileName = p.fileName;

        // plantingRef から year / field を抽出
        const yearFromRef = plantingRef.substring(0, 4);
        const firstDash = plantingRef.indexOf("-");
        const lastDash = plantingRef.lastIndexOf("-");
        const field = plantingRef.substring(firstDash + 1, lastDash);

        const summaryPath = `/logs/summary/${field}/${yearFromRef}/${fileName}`;

        let summaryData = null;
        try {
          summaryData = await loadJSON(summaryPath);
        } catch {
          html += `
            <div class="planting-card">
              <div class="info-line">plantingRef：${plantingRef}</div>
              <div class="info-line" style="color:#c00;">summary.json が見つかりません</div>
            </div>
          `;
          continue;
        }

        html += renderSummaryCard(summaryData);
      }

      html += `</div>`; // card end
    }
  }

  return html;
}

/* ===============================
   summary.json → カードHTML
   ★ 圃場と同じ info-line 構造
=============================== */
function renderSummaryCard(s) {

  const spacingText = `${s.planting.spacing.row}cm × ${s.planting.spacing.bed}cm`;

  const updatedJST = new Date(s.lastUpdated).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo"
  });

  return `
    <div class="planting-card">
      <div class="info-line">圃場：${s.field}</div>
      <div class="info-line">定植日：${s.planting.plantDate}</div>
      <div class="info-line">定植株数：${s.planting.quantity} 株（${s.planting.trayType || "-"}穴）</div>
      <div class="info-line">株間 × 条間：${spacingText}</div>
      <div class="info-line">収穫回数：${s.harvest.count}</div>
      <div class="info-line">収穫合計：${s.harvest.totalAmount} 基（${s.shipping.totalWeight.toFixed(1)} kg）</div>
      <div class="info-line">plantingRef：${s.plantingRef}</div>
      <div class="info-line" style="font-size:12px; color:#666;">最終更新：${updatedJST}</div>
    </div>
  `;
}
