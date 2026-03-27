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

  // ★ 圃場データ（存在しない場合は undefined のまま渡す）
  const fieldData = detail[rawFieldName];

  container.insertAdjacentHTML(
    "beforeend",
    renderFieldDetailCard(fieldData, rawFieldName, detail["TEMPLATE_FIELD"])
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