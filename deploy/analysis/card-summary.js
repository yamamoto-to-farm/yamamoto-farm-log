// card-summary.js（CloudFront 統一版）
import { safeFieldName } from "/common/utils.js";

const CF_BASE = "https://d3sscxnlo0qnhe.cloudfront.net";

/* ===============================
   メインエントリ：カード生成
=============================== */
export async function renderSummaryCards(rawFieldName) {
  const fieldName = safeFieldName(rawFieldName);

  // ★ CloudFront の最新 index を読む
  const index = await fetch(`${CF_BASE}/data/summary-index.json?ts=${Date.now()}`)
    .then(r => r.json())
    .catch(() => ({}));

  if (!index[fieldName]) {
    return `<p>サマリーがありません</p>`;
  }

  let html = "";

  for (const year of Object.keys(index[fieldName]).sort()) {
    html += `
      <details>
        <summary>${year} 年</summary>
        <div class="year-block">
    `;

    const files = index[fieldName][year];

    for (const file of files) {

      // ★ CloudFront の最新 summary.json を読む
      const url = `${CF_BASE}/logs/summary/${fieldName}/${year}/${file}?ts=${Date.now()}`;
      const summary = await fetch(url).then(r => r.json());

      html += renderSummaryCard(summary);
    }

    html += `</div></details>`;
  }

  return html;
}

/* ===============================
   summary.json → カードHTML
=============================== */
function renderSummaryCard(s) {

  const plantDate = new Date(s.planting.plantDate);
  const firstHarvest = new Date(s.harvest.firstDate);
  const lastHarvest = new Date(s.harvest.lastDate);

  const daysToHarvest =
    Math.floor((firstHarvest - plantDate) / (1000 * 60 * 60 * 24));

  const areaM2 =
    Number(s.planting.quantity) *
    (Number(s.planting.spacing.row) / 100) *
    (Number(s.planting.spacing.bed) / 100);

  const areaTan = areaM2 / 990;

  const spacingText = `${s.planting.spacing.row}cm × ${s.planting.spacing.bed}cm`;

  const updatedJST = new Date(s.lastUpdated).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo"
  });

  const totalAmount = s.harvest.totalAmount;
  const totalWeight = s.shipping.totalWeight;

  const avgPerUnit = totalAmount > 0
    ? (totalWeight / totalAmount).toFixed(2)
    : "-";

  const avgPerPlant = s.planting.quantity > 0
    ? (totalWeight / s.planting.quantity).toFixed(3)
    : "-";

  const yieldPer10a =
    areaM2 > 0 ? (totalWeight / (areaM2 / 1000)).toFixed(1) : "-";

  const yieldPerTan =
    areaTan > 0 ? (totalWeight / areaTan).toFixed(1) : "-";

  const yieldPerM2 =
    areaM2 > 0 ? (totalWeight / areaM2).toFixed(2) : "-";

  const harvestDays =
    Math.floor((lastHarvest - firstHarvest) / (1000 * 60 * 60 * 24)) + 1;

  const firstMD = s.harvest.firstDate?.slice(5).replace("-", "/");
  const lastMD = s.harvest.lastDate?.slice(5).replace("-", "/");

  const harvestPeriod =
    firstMD === lastMD
      ? `${firstMD}（1日）`
      : `${firstMD} ～ ${lastMD}（${harvestDays}日）`;

  const harvestEfficiency =
    harvestDays > 0 ? (s.harvest.count / harvestDays).toFixed(2) : "-";

  return `
    <div class="card">

      <h2>作付け別・定植〜出荷データ（${s.planting.plantDate.slice(0,4)}年）</h2>

      <div class="info-block">
        <div class="info-block-title">【定植情報】</div>
        <div class="info-line">品種：${s.planting.variety}</div>
        <div class="info-line">定植日：${s.planting.plantDate}</div>
        <div class="info-line">定植株数：${s.planting.quantity} 株（セルトレイ：${s.planting.trayType || "-"}穴）</div>
        <div class="info-line">株間 × 条間：${spacingText}</div>
        <div class="info-line">作付け面積：${areaTan.toFixed(2)} 反（${areaM2.toFixed(1)} ㎡）</div>
      </div>

      <div class="info-block">
        <div class="info-block-title">【収穫情報】</div>
        <div class="info-line">収穫期間：${harvestPeriod}</div>
        <div class="info-line">収穫回数：${s.harvest.count} 回</div>
        <div class="info-line">収穫合計：${totalAmount} 基（${totalWeight.toFixed(1)} kg）</div>
        <div class="info-line">定植 → 初回収穫：${daysToHarvest} 日</div>
      </div>

      <div class="info-block">
        <div class="info-block-title">【分析指標】</div>
        <div class="info-line">単収（作付け）：${yieldPer10a} kg/10a</div>
        <div class="info-line">反当たり収量：${yieldPerTan} kg/反</div>
        <div class="info-line">1株あたり収量：${avgPerPlant} kg/株</div>
        <div class="info-line">1基あたり平均重量：${avgPerUnit} kg/基</div>
        <div class="info-line">1㎡あたり収量：${yieldPerM2} kg/㎡</div>
        <div class="info-line">収穫効率：${harvestEfficiency} 回/日</div>
      </div>

      <div class="info-line" style="font-size:12px; color:#666;">
        最終更新：${updatedJST}
      </div>

    </div>
  `;
}