// summary-manager.js
import { cb, safeFieldName, safeFileName } from "../common/utils.js?v=2026031418";

export async function initSummaryManager() {

  async function loadIndex() {
    // 相対パス + キャッシュ破り（CORSなし）
    const url = cb("../data/summary-index.json") + `?t=${Date.now()}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return {};
    return await res.json();
  }

  async function loadCsv(path) {
    const url = cb(path) + `?t=${Date.now()}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return [];
    const text = await res.text();
    return Papa.parse(text, { header: true }).data;
  }

  function parsePlantingRef(plantingRef) {
    const parts = plantingRef.split("-");
    if (parts.length < 2) return null;
    return {
      field: parts[1],
      year: parts[0].substring(0, 4)
    };
  }

  function summaryExistsInIndex(index, field, year, safeRef) {
    return (
      index[field] &&
      index[field][year] &&
      index[field][year].includes(`${safeRef}.json`)
    );
  }

  async function getMissingSummaries() {
    const index = await loadIndex();
    const planting = await loadCsv("../logs/planting/all.csv");

    const missing = [];

    for (const p of planting) {
      if (!p.plantingRef) continue;

      const parsed = parsePlantingRef(p.plantingRef);
      if (!parsed) continue;

      const safeField = safeFieldName(parsed.field);
      const safeRef = safeFileName(p.plantingRef);

      const exists = summaryExistsInIndex(index, safeField, parsed.year, safeRef);

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
          <strong>${p.plantDate || "(日付不明)"} </strong> ${field} ${p.variety}
        </div>
        <button class="btn" data-ref="${p.plantingRef}">生成</button>
      `;

      container.appendChild(div);
    }

    container.querySelectorAll("button").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        const ref = e.target.dataset.ref;

        try {
          await window.summaryUpdate(ref);
          alert("サマリーを生成しました！");

          // ★ GitHub → Raw CDN の反映待ち
          await new Promise(r => setTimeout(r, 1500));

          const missing = await getMissingSummaries();
          renderList(missing);

        } catch (err) {
          console.error(err);
          alert("サマリー生成に失敗しました");
        }
      });
    });
  }

  document.getElementById("generateAll").addEventListener("click", async () => {
    const status = document.getElementById("status");
    status.textContent = "すべてのサマリーを生成中…";

    await window.summaryUpdateAll();

    status.textContent = "すべてのサマリー生成が完了しました。";

    // ★ 全保存後も反映待ち
    await new Promise(r => setTimeout(r, 1500));

    const missing = await getMissingSummaries();
    renderList(missing);
  });

  const missing = await getMissingSummaries();
  renderList(missing);
}