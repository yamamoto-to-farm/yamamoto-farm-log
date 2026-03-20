// analysis.js（統合フレーム）
import { verifyLocalAuth } from "/yamamoto-farm-log/common/ui.js";
import { renderSummaryCards } from "./card-summary.js";

window.addEventListener("DOMContentLoaded", async () => {

  // 認証チェック
  const ok = await verifyLocalAuth();
  if (!ok) return;

  // worker → 閲覧禁止
  if (window.currentRole !== "family" && window.currentRole !== "admin") {
    alert("このページは家族のみ閲覧できます");
    location.href = "/yamamoto-farm-log/map/index.html";
    return;
  }

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
  document.getElementById("latest-harvest").innerHTML = html;

  // ★ 将来ここに他カードも追加できる
  // const seedlingHTML = await renderSeedlingCard(rawFieldName);
  // document.getElementById("analysis-container").insertAdjacentHTML("beforeend", seedlingHTML);
});