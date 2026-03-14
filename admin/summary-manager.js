// summary-manager.js
import { cb, safeFieldName, safeFileName } from "../common/utils.js?v=2026031418";

export async function initSummaryManager() {

  /* ---------------------------------------------------------
     CSV 読み込み（404 → 空配列）
  --------------------------------------------------------- */
  async function loadCsv(path) {
    const res = await fetch(cb(path));
    if (!res.ok) return [];
    const text = await res.text();
    return Papa.parse(text, { header: true }).data;
  }

  /* ---------------------------------------------------------
     サマリー存在チェック（GET で静かに確認）
     → 404 が出ない
  --------------------------------------------------------- */
  async function summaryExists(field, year, plantingRef) {
    const safeField = safeFieldName(field);
    const safeRef = safeFileName(plantingRef);
    const path = `../logs/summary/${safeField}/${year}/${safeRef}.json`;

    try {
      const res = await fetch(cb(path), {
        method: "GET",
        cache: "no-store",
        redirect: "manual"
      });

      return res.ok; // 200 → true / 404 → false
    } catch {
      return false;
    }
  }

  /* ---------------------------------------------------------
     plantingRef → field/year
  --------------------------------------------------------- */
  function parsePlantingRef(plantingRef) {
    const parts = plantingRef.split("-");
    if (parts.length < 2) return null;
    return {
      field: parts[1],
      year: parts[0].substring(0, 4)
    };
  }

  /* ---------------------------------------------------------
     未生成サマリー一覧
  --------------------------------------------------------- */
  async function getMissingSummaries() {
    const planting = await loadCsv("../logs/planting/all.csv");
    const missing = [];

    for (const p of planting) {
      if (!p.plantingRef) continue;

      const parsed = parsePlantingRef(p.plantingRef);
      if (!parsed) continue;

      const exists = await summaryExists(parsed.field, parsed.year, p.plantingRef);
      if (!exists) missing.push(p);
    }

    return missing;
  }

  /* ---------------------------------------------------------
     UI 描画
  --------------------------------------------------------- */
  function renderList(list) {
    const container = document.getElementById("summaryList");
    container.innerHTML = "";

    if (list.length === 0) {
      container.innerHTML = "<p>すべてのサマリーが生成済みです。</p>";
      return;
    }

    for (const p of list) {
      const parsed = parsePlantingRef(p.plantingRef);
      const field = parsed ? parsed.field : "(不明)";

      const div = document.createElement("div");
      div.className = "item";

      div.innerHTML = `
        <div>
          <strong>${p.plantDate || "(日付不明)"}</strong> ${field} ${p.variety}
        </div>
        <button class="btn" data-ref="${p.plantingRef}">生成</button>
      `;

      container.appendChild(div);
    }

    // 個別生成
    container.querySelectorAll("button").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        const ref = e.target.dataset.ref;
        await window.summaryUpdate(ref);   // ← window 方式
        const missing = await getMissingSummaries();
        renderList(missing);
      });
    });
  }

  /* ---------------------------------------------------------
     すべて生成
  --------------------------------------------------------- */
  document.getElementById("generateAll").addEventListener("click", async () => {
    const status = document.getElementById("status");
    status.textContent = "すべてのサマリーを生成中…";

    await window.summaryUpdateAll();       // ← window 方式

    status.textContent = "すべてのサマリー生成が完了しました。";

    const missing = await getMissingSummaries();
    renderList(missing);
  });

  /* ---------------------------------------------------------
     初期表示
  --------------------------------------------------------- */
  const missing = await getMissingSummaries();
  renderList(missing);
}