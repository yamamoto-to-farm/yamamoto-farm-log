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
     ★ 基本データカード（圃場と同じ構造）
  =============================== */
  container.insertAdjacentHTML("beforeend", `
    <h2>基本データ</h2>
    <div class="card">
      ${renderVarietyDetailCard(
        detail[varietyName],
        varietyName,
        detail["TEMPLATE_VARIETY"]
      )}
    </div>
  `);


  /* ===============================
     ★ 年ごとのサマリーカード（variety-index.json）
        → card-variety-summary.js 側でカード化済み
  =============================== */
  if (DEBUG) console.log("=== summary カード生成開始 ===");

  const summaryHTML = await renderVarietySummaryCards(varietyName);
  container.insertAdjacentHTML("beforeend", summaryHTML);

  if (DEBUG) console.log("=== summary カード生成完了 ===");

  if (DEBUG) console.log("=== initVarietyDetail 完了 ===");
}

// ▼ 開閉イベント（圃場と同じ）
document.querySelectorAll(".toggle-title").forEach(title => {
  title.addEventListener("click", () => {
    const targetId = title.dataset.target;
    const body = document.getElementById(targetId);
    const isOpen = title.dataset.open === "true";

    body.style.display = isOpen ? "none" : "block";
    title.dataset.open = isOpen ? "false" : "true";
  });
});
