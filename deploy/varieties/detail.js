// varieties/detail.js
import { loadJSON } from "/common/json.js";
import { renderVarietyDetailCard } from "./card-variety-detail.js";
import { renderVarietySummaryCards } from "./card-variety-summary.js";

// デバッグフラグ
const DEBUG = false;

export async function initVarietyDetail(varietyName) {

  const container = document.getElementById("variety-container");

  /* ===============================
     ★ 基本データカード
  =============================== */
  if (DEBUG) console.log("=== variety-detail.json 読み込み開始 ===");

  const detail = await loadJSON("/data/variety-detail.json");

  if (DEBUG) {
    console.log("=== 読み込んだ detail ===", detail);
    console.log("=== detail keys ===", Object.keys(detail || {}));
    console.log("=== TEMPLATE_VARIETY ===", detail?.TEMPLATE_VARIETY);
  }

  if (!detail) {
    container.innerHTML = "<p>品種データが読み込めませんでした。</p>";
    return;
  }

  // ★ 「読み込み中…」を消す
  container.innerHTML = "";

  // ★ 基本データカードを追加
  container.insertAdjacentHTML(
    "beforeend",
    renderVarietyDetailCard(
      detail[varietyName],          // 品種データ
      varietyName,                  // 品種名
      detail["TEMPLATE_VARIETY"]    // テンプレート
    )
  );

  /* ===============================
     ★ サマリーカード（過去の実績など）
  =============================== */
  if (DEBUG) console.log("=== summary カード生成開始 ===");

  const summaryHTML = await renderVarietySummaryCards(varietyName);
  container.insertAdjacentHTML("beforeend", summaryHTML);

  if (DEBUG) console.log("=== summary カード生成完了 ===");

  /* ===============================
     ★ 基本データカードの開閉イベント
  =============================== */
  /* ===============================
     ★ 基本データカードの開閉イベント
  =============================== */
  document.querySelectorAll(".basic-title").forEach(title => {
    title.addEventListener("click", () => {
      const body = title.nextElementSibling;
      const isOpen = title.dataset.open === "true";

      body.style.display = isOpen ? "none" : "block";
      title.dataset.open = isOpen ? "false" : "true";
      title.textContent = `${isOpen ? "▶" : "▼"} 基本データ`;
    });
  });

  if (DEBUG) console.log("=== initVarietyDetail 完了 ===");
}
