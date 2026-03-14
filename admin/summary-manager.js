// summary-manager.js
import { cb, safeFieldName, safeFileName } from "../common/utils.js?v=2026031418";

export async function initSummaryManager() {

  async function loadCsv(path) {
    const res = await fetch(cb(path));
    if (!res.ok) return [];
    const text = await res.text();
    return Papa.parse(text, { header: true }).data;
  }

  async function summaryExists(field, year, plantingRef) {
    const safeField = safeFieldName(field);
    const safeRef = safeFileName(plantingRef);
    const path = `../logs/summary/${safeField}/${year}/${safeRef}.json`;

    try {
      const res = await fetch(cb(path), { method: "HEAD", cache: "no-store" });
      
      // 404 → 未生成 → false
      if (res.status === 404) return false;

      return res.ok;
    } catch {
      return false;
    }
  }

  function parsePlantingRef(plantingRef) {
    const parts = plantingRef.split("-");
    if (parts.length < 2) return null;
    return {
      field: parts[1],
      year: parts[0].substring(0, 4)
    };
  }

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

    container.querySelectorAll("button").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        const ref = e.target.dataset.ref;
        await window.summaryUpdate(ref);   // ← window 方式
        const missing = await getMissingSummaries();
        renderList(missing);
      });
    });
  }

  document.getElementById("generateAll").addEventListener("click", async () => {
    const status = document.getElementById("status");
    status.textContent = "すべてのサマリーを生成中…";

    await window.summaryUpdateAll();       // ← window 方式

    status.textContent = "すべてのサマリー生成が完了しました。";

    const missing = await getMissingSummaries();
    renderList(missing);
  });

  const missing = await getMissingSummaries();
  renderList(missing);
}