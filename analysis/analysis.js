// analysis.js（統合フレーム）
import { renderSummaryCards } from "./card-summary.js";

export async function initAnalysisPage() {

  // URL パラメータから圃場名取得
  const params = new URLSearchParams(location.search);
  const rawFieldName = params.get("field");

  if (!rawFieldName) {
    document.getElementById("field-name").textContent = "圃場を選択してください";
    return;
  }

  // タイトル設定
  document.getElementById("field-name").textContent = `圃場分析＿${rawFieldName}`;

  // ★ summary カードを生成して配置
  const html = await renderSummaryCards(rawFieldName);
  document.getElementById("analysis-container").insertAdjacentHTML("beforeend", html);

  // ★ 将来ここに他カードも追加できる
  // const seedlingHTML = await renderSeedlingCard(rawFieldName);
  // document.getElementById("analysis-container").insertAdjacentHTML("beforeend", seedlingHTML);
}