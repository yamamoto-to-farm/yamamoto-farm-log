// summary-manager.js
import { cb, safeFieldName, safeFileName } from "../common/utils.js";

/* ---------------------------------------------------------
   CSV 読み込み
--------------------------------------------------------- */
async function loadCsv(path) {
  const res = await fetch(cb(path));
  if (!res.ok) return [];
  const text = await res.text();
  return Papa.parse(text, { header: true }).data;
}

/* ---------------------------------------------------------
   サマリー存在チェック（HEAD）
--------------------------------------------------------- */
async function summaryExists(field, year, plantingRef) {
  const safeField = safeFieldName(field);
  const safeRef = safeFileName(plantingRef);

  const path = `../logs/summary/${safeField}/${year}/${safeRef}.json`;

  try {
    const res = await fetch(cb(path), { method: "HEAD", cache: "no-store" });
    return res.ok;
  } catch (e) {
    return false;
  }
}

/* ---------------------------------------------------------
   plantingRef → field/year 抽出
--------------------------------------------------------- */
function parsePlantingRef(plantingRef) {
  if (!plantingRef || typeof plantingRef !== "string") return null;

  const parts = plantingRef.split("-");
  if (parts.length < 2) return null;

  const date = parts[0];
  const field = parts[1];
  const year = date.substring(0, 4);

  if (!field || !year) return null;

  return { field, year };
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

    const { field, year } = parsed;

    const exists = await summaryExists(field, year, p.plantingRef);
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

  container.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const ref = e.target.dataset.ref;
      await generateOne(ref);
    });
  });
}

/* ---------------------------------------------------------
   個別生成
--------------------------------------------------------- */
async function generateOne(plantingRef) {
  const status = document.getElementById("status");
  status.textContent = `${plantingRef} を生成中…`;

  await summaryUpdate(plantingRef);

  status.textContent = `${plantingRef} の生成が完了しました。`;

  const missing = await getMissingSummaries();
  renderList(missing);
}

/* ---------------------------------------------------------
   一括生成
--------------------------------------------------------- */
async function generateAll() {
  const status = document.getElementById("status");
  status.textContent = "すべてのサマリーを生成中…";

  await summaryUpdateAll();

  status.textContent = "すべてのサマリー生成が完了しました。";

  const missing = await getMissingSummaries();
  renderList(missing);
}

/* ---------------------------------------------------------
   初期化
--------------------------------------------------------- */
async function init() {
  const missing = await getMissingSummaries();
  renderList(missing);

  document.getElementById("generateAll").addEventListener("click", generateAll);
}

init();