// analysis.js（CloudFront 統一版）
import { loadJSON } from "/common/json.js";
import { renderSummaryCards } from "./card-summary.js";
import { renderFieldDetailCard } from "./card-field-detail.js";

export async function initAnalysisPage() {

  const params = new URLSearchParams(location.search);
  const rawFieldName = params.get("field");
  if (!rawFieldName) return;

  document.getElementById("field-name").textContent = `圃場分析＿${rawFieldName}`;

  const container = document.getElementById("analysis-container");

  /* ===============================
     ★ 基本データカード
  =============================== */
  console.log("=== field-detail.json 読み込み開始 ===");

  const detail = await loadJSON("/data/field-detail.json");

  console.log("=== 読み込んだ detail ===", detail);
  console.log("=== detail keys ===", Object.keys(detail || {}));
  console.log("=== TEMPLATE_FIELD ===", detail?.TEMPLATE_FIELD);

  if (!detail) {
    console.error("❌ detail が null/undefined。JSON が読み込めていない可能性");
  }

  if (!detail?.TEMPLATE_FIELD) {
    console.error("❌ TEMPLATE_FIELD が undefined。JSON に存在しないか、キャッシュの可能性");
  }

  if (!detail?.[rawFieldName]) {
    console.warn(`⚠️ 圃場データ '${rawFieldName}' は存在しない → テンプレートを使う`);
  }

  // ★ ここが抜けていた：基本データカードを描画する
  container.insertAdjacentHTML(
    "beforeend",
    renderFieldDetailCard(
      detail[rawFieldName],        // 圃場データ（undefined ならテンプレート扱い）
      rawFieldName,                // 圃場名
      detail["TEMPLATE_FIELD"]     // テンプレート
    )
  );

  /* ===============================
     ★ サマリーカード
  =============================== */
  const summaryHTML = await renderSummaryCards(rawFieldName);
  container.insertAdjacentHTML("beforeend", summaryHTML);

  /* ===============================
     ★ 基本データカードの開閉イベント
  =============================== */
  document.querySelectorAll(".basic-toggle").forEach(title => {
    title.addEventListener("click", () => {
      const body = title.nextElementSibling;
      const isOpen = body.style.display !== "none";

      body.style.display = isOpen ? "none" : "block";
    });
  });
}