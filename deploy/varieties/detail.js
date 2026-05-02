// varieties/detail.js
import { loadJSON } from "/common/json.js";
import { renderVarietyDetailCard } from "./card-variety-detail.js";
import { renderVarietySummaryCards } from "./card-variety-summary.js";

// デバッグフラグ
const DEBUG = false;

export async function initVarietyDetail(varietyName) {

  const container = document.getElementById("variety-container");
  container.innerHTML = "読み込み中…";

  /* ===============================
     ★ 基本データ（variety-detail.json）
  =============================== */
  let detail = {};
  try {
    detail = await loadJSON("/data/variety-detail.json");
  } catch {
    container.innerHTML = "<p>品種データが読み込めませんでした。</p>";
    return;
  }

  // 初期化
  container.innerHTML = "";

  /* ===============================
     ★ 基本データカード（analysis.js と同じ構造）
  =============================== */
  container.insertAdjacentHTML(
    "beforeend",
    renderVarietyDetailCard(
      detail[varietyName],
      varietyName,
      detail["TEMPLATE_VARIETY"]
    )
  );

  /* ===============================
     ★ 年ごとのサマリーカード
  =============================== */
  if (DEBUG) console.log("=== summary カード生成開始 ===");

  const summaryHTML = await renderVarietySummaryCards(varietyName);
  container.insertAdjacentHTML("beforeend", summaryHTML);

  if (DEBUG) console.log("=== summary カード生成完了 ===");

  /* ===============================
     ★ 開閉イベント（analysis.js と完全一致）
  =============================== */
  document.querySelectorAll(".basic-toggle").forEach(title => {
    title.addEventListener("click", () => {
      const body = title.nextElementSibling;
      const isOpen = body.style.display !== "none";
      body.style.display = isOpen ? "none" : "block";
    });
  });

  if (DEBUG) console.log("=== initVarietyDetail 完了 ===");
}
