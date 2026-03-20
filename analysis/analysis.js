import { verifyLocalAuth } from "/yamamoto-farm-log/common/ui.js";
import { safeFieldName } from "/yamamoto-farm-log/common/utils.js";

/* ===============================
   ページ読み込み
=============================== */
window.addEventListener("DOMContentLoaded", async () => {
  const ok = await verifyLocalAuth();
  if (!ok) return;

  if (window.currentRole !== "family" && window.currentRole !== "admin") {
    alert("このページは家族のみ閲覧できます");
    location.href = "../map/index.html";
    return;
  }

  initAnalysisPage();
});

/* ===============================
   メイン処理
=============================== */
export async function initAnalysisPage() {
  const params = new URLSearchParams(location.search);
  const rawFieldName = params.get("field");

  if (!rawFieldName) {
    const fields = await fetch("/yamamoto-farm-log/data/fields.json").then(r => r.json());

    document.body.innerHTML = `
      <h1>圃場を選択</h1>
      <ul id="field-list" style="padding-left:0;"></ul>
    `;

    const ul = document.getElementById("field-list");

    fields.forEach(f => {
      const li = document.createElement("li");
      li.innerHTML = `
        <a href="index.html?field=${encodeURIComponent(f.name)}">
          ${f.name}
        </a>
      `;
      li.style.fontSize = "20px";
      li.style.margin = "12px 0";
      li.style.listStyle = "none";
      ul.appendChild(li);
    });

    return;
  }

  const fieldName = safeFieldName(rawFieldName);
  document.getElementById("field-name").textContent = `圃場分析＿${rawFieldName}`;

  const index = await fetch("/yamamoto-farm-log/data/summary-index.json")
    .then(r => r.json())
    .catch(() => ({}));

  if (!index[fieldName]) {
    document.getElementById("latest-harvest").textContent = "サマリーがありません";
    return;
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
      const url = `/yamamoto-farm-log/logs/summary/${fieldName}/${year}/${file}`;
      const summary = await fetch(url).then(r => r.json());
      html += renderSummaryCard(summary);
    }

    html += `
        </div>
      </details>
    `;
  }

  document.getElementById("latest-harvest").innerHTML = html;
}

/* ===============================
   summary.json → カード生成
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
    ? ((totalWeight * 1000) / totalAmount).toFixed(0)
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
        <div class="info-line">1株あたり収量：${avgPerUnit} g/株</div>
        <div class="info-line">1基あたり平均重量：${avgPerUnit} g/基</div>
        <div class="info-line">1㎡あたり収量：${yieldPerM2} kg/㎡</div>
        <div class="info-line">収穫効率：${(s.harvest.count / harvestDays).toFixed(2)} 回/日</div>
      </div>

      <div class="info-line" style="font-size:12px; color:#666;">
        最終更新：${updatedJST}
      </div>

    </div>
  `;
}