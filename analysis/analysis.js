import { verifyLocalAuth } from "/yamamoto-farm-log/common/ui.js";
import { safeFieldName } from "/yamamoto-farm-log/common/utils.js";

// ===============================
// ページ読み込み → 認証チェック → メイン処理
// ===============================
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


// ===============================
// ★ メイン処理（summary ベース）
// ===============================
export async function initAnalysisPage() {

  const params = new URLSearchParams(location.search);
  const rawFieldName = params.get("field");

  // 圃場未指定 → 一覧表示
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

  // ★ 正規化（summary フォルダ名と一致させる）
  const fieldName = safeFieldName(rawFieldName);
  document.getElementById("field-name").textContent = rawFieldName;


  // ===============================
  // summary-index.json を読み込む
  // ===============================
  const index = await fetch("/yamamoto-farm-log/data/summary-index.json")
    .then(r => r.json())
    .catch(() => ({}));

  if (!index[fieldName]) {
    document.getElementById("latest-harvest").textContent = "サマリーがありません";
    return;
  }

  // 年ごとにまとめて表示
  let html = "";

  for (const year of Object.keys(index[fieldName]).sort()) {

    html += `<h2>${year} 年</h2>`;

    const files = index[fieldName][year];

    for (const file of files) {

      const url = `/yamamoto-farm-log/logs/summary/${fieldName}/${year}/${file}`;
      const summary = await fetch(url).then(r => r.json());

      const cardHtml = renderSummaryCard(summary);
      html += cardHtml + "<hr>";
    }
  }

  document.getElementById("latest-harvest").innerHTML = html;
}



// ===============================
// ★ summary.json → カード HTML（analysis が計算）
// ===============================
function renderSummaryCard(s) {

  // --- 日付 ---
  const plantDate = new Date(s.planting.plantDate);
  const firstHarvest = new Date(s.harvest.firstDate);

  const daysToHarvest =
    Math.floor((firstHarvest - plantDate) / (1000 * 60 * 60 * 24));

  // --- 面積計算 ---
  const areaM2 =
    Number(s.planting.quantity) *
    (Number(s.planting.spacing.row) / 100) *
    (Number(s.planting.spacing.bed) / 100);

  // --- 単収 ---
  const yieldPer10a =
    areaM2 > 0 ? (Number(s.shipping.totalWeight) / (areaM2 / 1000)).toFixed(1) : "-";

  return `
    <div class="summary-card">

      <div class="info-line">品種：${s.planting.variety}</div>

      <div class="info-line">定植日：${s.planting.plantDate}</div>

      <div class="info-line">セルトレイ：${s.planting.trayType || "-"}穴</div>

      <div class="info-line">収穫期間：${s.harvest.firstDate} ～ ${s.harvest.lastDate}</div>
      <div class="info-line">収穫回数：${s.harvest.count} 回</div>

      <div class="info-line">合計重量：${Number(s.shipping.totalWeight).toFixed(1)} kg</div>

      <div class="info-line">定植 → 初回収穫：${daysToHarvest} 日</div>

      <div class="info-line">作付け面積：${areaM2.toFixed(1)} ㎡</div>

      <div class="info-line">単収（作付け）：${yieldPer10a} kg/10a</div>

      <div class="info-line" style="font-size:12px; color:#666;">
        最終更新：${s.lastUpdated}
      </div>

    </div>
  `;
}