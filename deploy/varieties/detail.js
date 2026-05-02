// varieties/detail.js
import { loadJSON } from "/common/json.js";
import { loadCSV, normalizeKeys } from "/common/csv.js";
import { renderVarietyDetailCard } from "./card-variety-detail.js";

// デバッグフラグ
const DEBUG = false;

export async function initVarietyDetail(varietyName) {

  const container = document.getElementById("variety-container");
  container.innerHTML = "読み込み中…";

  /* ===============================
     ★ 基本データカード（variety-detail.json）
  =============================== */
  let detail = {};
  try {
    detail = await loadJSON("/data/variety-detail.json");
  } catch {
    container.innerHTML = "<p>品種データが読み込めませんでした。</p>";
    return;
  }

  container.innerHTML = "";

  container.insertAdjacentHTML(
    "beforeend",
    renderVarietyDetailCard(
      detail[varietyName],
      varietyName,
      detail["TEMPLATE_VARIETY"]
    )
  );

  /* ===============================
     ★ variety-index.json を読み込む
  =============================== */
  let vIndex = {};
  try {
    vIndex = await loadJSON("/data/variety-index.json");
  } catch {
    container.insertAdjacentHTML("beforeend", "<p>variety-index.json が読み込めませんでした。</p>");
    return;
  }

  const years = vIndex[varietyName];
  if (!years) {
    container.insertAdjacentHTML("beforeend", "<p>この品種の実績データはありません。</p>");
    return;
  }

  /* ===============================
     ★ seed/all.csv（seedRef の詳細用）
  =============================== */
  let seedRows = [];
  try {
    seedRows = normalizeKeys(await loadCSV("/logs/seed/all.csv"));
  } catch {
    console.warn("seed/all.csv が読み込めませんでした");
  }

  /* ===============================
     ★ 年ごとのカード生成
  =============================== */
  for (const year of Object.keys(years).sort()) {

    const { seed = [], planting = [] } = years[year];

    const yearCard = document.createElement("details");
    yearCard.className = "year-card";
    yearCard.open = true;

    const summary = document.createElement("summary");
    summary.textContent = `${year}年の実績`;
    yearCard.appendChild(summary);

    const wrap = document.createElement("div");
    wrap.className = "year-content";

    /* -------------------------
       ★ seedRef のカード
    ------------------------- */
    if (seed.length > 0) {
      const seedTitle = document.createElement("h3");
      seedTitle.textContent = "播種（seedRef）";
      wrap.appendChild(seedTitle);

      seed.forEach(ref => {
        const row = seedRows.find(r => r.seedRef === ref);

        const div = document.createElement("div");
        div.className = "seed-card";

        if (row) {
          div.innerHTML = `
            <div>播種日：${row.seedDate}</div>
            <div>数量：${row.quantity || "-"}</div>
            <div>seedRef：${ref}</div>
          `;
        } else {
          div.innerHTML = `<div>seedRef：${ref}</div>`;
        }

        wrap.appendChild(div);
      });
    }

    /* -------------------------
       ★ plantingRef のカード
    ------------------------- */
    if (planting.length > 0) {
      const plantTitle = document.createElement("h3");
      plantTitle.textContent = "定植（plantingRef）";
      wrap.appendChild(plantTitle);

      for (const ref of planting) {

        // summary.json のパスは variety-index.json に fileName を入れるのが理想だが
        // 今は plantingRef.json として簡易に読む
        const summaryPath = `/logs/summary/${ref}.json`;

        let summaryData = null;
        try {
          summaryData = await loadJSON(summaryPath);
        } catch {
          console.warn("summary 読み込み失敗:", summaryPath);
        }

        const div = document.createElement("div");
        div.className = "planting-card";

        if (summaryData) {
          div.innerHTML = `
            <div>定植日：${summaryData.planting.plantDate}</div>
            <div>圃場：${summaryData.planting.field}</div>
            <div>収穫回数：${summaryData.harvest.count}</div>
            <div>plantingRef：${ref}</div>
          `;
        } else {
          div.innerHTML = `<div>plantingRef：${ref}</div>`;
        }

        wrap.appendChild(div);
      }
    }

    yearCard.appendChild(wrap);
    container.appendChild(yearCard);
  }

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
