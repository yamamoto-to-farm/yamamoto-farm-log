// analysis.js（統合フレーム）
import { loadJSON } from "/yamamoto-farm-log/common/json.js";
import { safeFieldName } from "/yamamoto-farm-log/common/utils.js";
import { renderSummaryCards } from "./card-summary.js";

export async function initAnalysisPage() {

  // URL パラメータから圃場名取得
  const params = new URLSearchParams(location.search);
  const rawFieldName = params.get("field");

  if (!rawFieldName) return;

  // タイトル設定
  document.getElementById("field-name").textContent = `圃場分析＿${rawFieldName}`;

  const container = document.getElementById("analysis-container");

  /* ===============================
     ★ 基本データカード（field-detail.json）
  =============================== */
  const detail = await loadJSON("data/field-detail.json");
  const fieldKey = safeFieldName(rawFieldName);
  const fieldData = detail[fieldKey];

  container.insertAdjacentHTML("beforeend", renderBasicFieldCard(fieldData));

  /* ===============================
     ★ サマリーカード（年度別）
  =============================== */
  const summaryHTML = await renderSummaryCards(rawFieldName);
  container.insertAdjacentHTML("beforeend", summaryHTML);
}

/* ===============================
   基本データカード（field-detail.json）
=============================== */
function renderBasicFieldCard(f) {
  if (!f) return `<p>基本データがありません</p>`;

  return `
    <div class="card basic-card">
      <h2>基本データ</h2>

      <div class="info-line">実耕作面積：${f.size ?? "-"} a</div>
      <div class="info-line">特徴：${f.memo ?? "-"}</div>

      ${f.soil ? `
        <div class="info-block">
          <div class="info-block-title">【土壌分析】</div>
          <div class="info-line">pH：${f.soil.ph ?? "-"}</div>
          <div class="info-line">EC：${f.soil.ec ?? "-"}</div>
          <div class="info-line">土質：${f.soil.texture ?? "-"}</div>
        </div>
      ` : ""}

      <div class="info-block">
        <div class="info-block-title">【筆情報】</div>
        ${f.parcels.map(p => `
          <div class="info-line">
            ${p.lotNumber}（${p.landCategory} / ${p.officialArea}㎡ / ${p.owner} / ${p.rightType}）
          </div>
        `).join("")}
      </div>
    </div>
  `;
}