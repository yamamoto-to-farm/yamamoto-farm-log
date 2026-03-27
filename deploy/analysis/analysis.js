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
  const detail = await loadJSON("/data/field-detail.json");

  // ★ JSON 内のテンプレートを取得
  const TEMPLATE_FIELD = detail["TEMPLATE_FIELD"];

  // ★ 圃場データが無い場合はテンプレートを使用
  const fieldData = detail[rawFieldName]
    ? detail[rawFieldName]
    : { ...TEMPLATE_FIELD, __empty: true, field: rawFieldName };

  container.insertAdjacentHTML(
    "beforeend",
    renderFieldDetailCard(fieldData)
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