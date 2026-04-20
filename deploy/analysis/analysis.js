// analysis.js（CloudFront 統一版 + デバッグ切替）
import { loadJSON } from "/common/json.js";
import { renderSummaryCards } from "./card-summary.js";
import { renderFieldDetailCard } from "./card-field-detail.js";

// ★ デバッグフラグ（true でログ出る）
const DEBUG = false;

export async function initAnalysisPage() {

  const params = new URLSearchParams(location.search);
  const rawFieldName = params.get("field");
  if (!rawFieldName) return;

  document.getElementById("field-name").textContent = `圃場詳細＿${rawFieldName}`;

  const container = document.getElementById("analysis-container");

  /* ===============================
     ★ 基本データカード
  =============================== */
  if (DEBUG) console.log("=== field-detail.json 読み込み開始 ===");

  const detail = await loadJSON("/data/field-detail.json");

  if (DEBUG) {
    console.log("=== 読み込んだ detail ===", detail);
    console.log("=== detail keys ===", Object.keys(detail || {}));
    console.log("=== TEMPLATE_FIELD ===", detail?.TEMPLATE_FIELD);
  }

  if (DEBUG && !detail) {
    console.error("❌ detail が null/undefined。JSON が読み込めていない可能性");
  }

  if (DEBUG && !detail?.TEMPLATE_FIELD) {
    console.error("❌ TEMPLATE_FIELD が undefined。JSON に存在しないか、キャッシュの可能性");
  }

  if (DEBUG && !detail?.[rawFieldName]) {
    console.warn(`⚠️ 圃場データ '${rawFieldName}' は存在しない → テンプレートを使う`);
  }

  // ★ 「読み込み中…」を消す
  container.innerHTML = "";

  // ★ 基本データカードを追加
  container.insertAdjacentHTML(
    "beforeend",
    renderFieldDetailCard(
      detail[rawFieldName],        // 圃場データ
      rawFieldName,                // 圃場名
      detail["TEMPLATE_FIELD"]     // テンプレート
    )
  );

  /* ===============================
     ★ サマリーカード
  =============================== */
  if (DEBUG) console.log("=== summary カード生成開始 ===");

  const summaryHTML = await renderSummaryCards(rawFieldName);
  container.insertAdjacentHTML("beforeend", summaryHTML);

  if (DEBUG) console.log("=== summary カード生成完了 ===");

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

  if (DEBUG) console.log("=== initAnalysisPage 完了 ===");
}