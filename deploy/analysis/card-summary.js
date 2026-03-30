// card-summary.js（CloudFront 統一版）
import { safeFieldName } from "/common/utils.js";
import { loadNotesForPlantingRef } from "./notes.js";   // ★ 追加

const CF_BASE = "https://d3sscxnlo0qnhe.cloudfront.net";

/* ===============================
   メインエントリ：カード生成
=============================== */
export async function renderSummaryCards(rawFieldName) {
  const fieldName = safeFieldName(rawFieldName);

  const index = await fetch(`${CF_BASE}/data/summary-index.json?ts=${Date.now()}`)
    .then(r => r.json())
    .catch(() => ({}));

  if (!index[fieldName]) {
    return `<p>サマリーがありません</p>`;
  }

  // ★ 目標値（harvestBase.json）を先に読み込む
  const harvestBase = await fetch(`${CF_BASE}/data/harvestBase.json?ts=${Date.now()}`)
    .then(r => r.json())
    .catch(() => ({ monthly: {} }));

  let html = "";

  for (const year of Object.keys(index[fieldName]).sort()) {
    html += `
      <details>
        <summary>${year} 年</summary>
        <div class="year-block">
    `;

    const files = index[fieldName][year];

    for (const file of files) {
      const url = `${CF_BASE}/logs/summary/${fieldName}/${year}/${file}?ts=${Date.now()}`;
      const summary = await fetch(url).then(r => r.json());

      html += await renderSummaryCard(summary, harvestBase);  // ★ await に変更
    }

    html += `</div></details>`;
  }

  return html;
}

/* ===============================
   達成率の色クラス判定
=============================== */
function getRateClass(rate) {
  if (rate === "—") return "";
  const r = Number(rate);
  if (r >= 100) return "rate-good";
  if (r >= 80) return "rate-ok";
  return "rate-bad";
}

/* ===============================
   summary.json → カードHTML
=============================== */
async function renderSummaryCard(s, harvestBase) {

  /* -------------------------------
     日付の安全処理
  --------------------------------*/
  const plantDate = new Date(s.planting.plantDate);
  const firstHarvest = s.harvest.firstDate ? new Date(s.harvest.firstDate) : null;
  const lastHarvest = s.harvest.lastDate ? new Date(s.harvest.lastDate) : null;

  const hasHarvest = !!firstHarvest && !!lastHarvest && s.harvest.count > 0;

  const daysToHarvest = hasHarvest
    ? Math.floor((firstHarvest - plantDate) / (1000 * 60 * 60 * 24))
    : null;

  /* -------------------------------
     面積計算
  --------------------------------*/
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

  /* -------------------------------
     主指標：反収（kg/反）
  --------------------------------*/
  const yieldPerTan = hasHarvest
    ? (totalWeight / areaTan).toFixed(1)
    : "—";

  /* -------------------------------
     主指標：1基あたり平均重量（kg/基）
  --------------------------------*/
  const avgPerUnit = hasHarvest
    ? (totalWeight / totalAmount).toFixed(2)
    : "—";

  /* -------------------------------
     目標反収（harvestBase.json）
  --------------------------------*/
  const ym = s.planting.harvestPlanYM;
  const month = ym?.slice(5);

  const targetPerTan = month && harvestBase.monthly[month]
    ? harvestBase.monthly[month].yieldPerTan
    : null;

  /* -------------------------------
     達成率（%）
  --------------------------------*/
  const achieveRate =
    hasHarvest && targetPerTan
      ? ((yieldPerTan / targetPerTan) * 100).toFixed(1)
      : "—";

  const rateClass = getRateClass(achieveRate);

  /* -------------------------------
     収穫期間
  --------------------------------*/
  let harvestPeriod = "未収穫";

  if (hasHarvest) {
    const firstMD = s.harvest.firstDate.slice(5).replace("-", "/");
    const lastMD = s.harvest.lastDate.slice(5).replace("-", "/");

    const harvestDays =
      Math.floor((lastHarvest - firstHarvest) / (1000 * 60 * 60 * 24)) + 1;

    harvestPeriod =
      firstMD === lastMD
        ? `${firstMD}（1日）`
        : `${firstMD} ～ ${lastMD}（${harvestDays}日）`;
  }

  /* -------------------------------
     ★ 現場メモ（notes.js）
  --------------------------------*/
  const notes = await loadNotesForPlantingRef(s.planting.plantingRef);

  const notesHTML =
    notes.length > 0
      ? `
      <div class="info-block">
        <div class="info-block-title">【現場メモ】</div>
        ${notes.map(n => `<div class="info-line">・${n}</div>`).join("")}
      </div>
      `
      : "";

  /* -------------------------------
     HTML 出力
  --------------------------------*/
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
        <div class="info-line">定植 → 初回収穫：${daysToHarvest !== null ? daysToHarvest + " 日" : "—"}</div>
      </div>

      <div class="info-block">
        <div class="info-block-title">【分析指標】</div>
        <div class="info-line">反当たり収量：${yieldPerTan} kg/反</div>
        <div class="info-line">1基あたり平均重量：${avgPerUnit} kg/基</div>
      </div>

      <div class="info-block">
        <div class="info-block-title">【目標比較】</div>
        <div class="info-line">目標反収：${targetPerTan ? targetPerTan + " kg/反" : "—"}</div>
        <div class="info-line">
          達成率：
          <span class="${rateClass}">
            ${achieveRate !== "—" ? achieveRate + "%" : "—"}
          </span>
        </div>
      </div>

      ${notesHTML}

      <div class="info-line" style="font-size:12px; color:#666;">
        最終更新：${updatedJST}
      </div>

    </div>
  `;
}