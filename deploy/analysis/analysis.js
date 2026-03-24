// analysis.js（統合フレーム）
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
  const detail = await loadJSON("data/field-detail.json");
  const fieldData = detail[rawFieldName];

  if (fieldData) {
    container.insertAdjacentHTML("beforeend", renderFieldDetailCard(fieldData));
  }

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