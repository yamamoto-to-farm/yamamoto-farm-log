// summary-manager.js — 完全版（すべて生成は1回だけ通知）

import { cb, safeFieldName, safeFileName } from "../common/utils.js?v=2026031418";

/* ---------------------------------------------------------
   1. index.json の読み込み
--------------------------------------------------------- */
async function loadIndex() {
  // ★ summary.js が更新したローカルキャッシュを優先
  if (window.indexCache) {
    return window.indexCache;
  }

  // ★ なければ fetch
  try {
    const res = await fetch(cb("../data/summary-index.json"), { cache: "no-store" });
    if (!res.ok) return {};
    return await res.json();
  } catch {
    return {};
  }
}

/* ---------------------------------------------------------
   2. 未生成チェック
--------------------------------------------------------- */
async function getMissingSummaries() {
  const index = await loadIndex();

  const planting = await fetch(cb("../logs/planting/all.csv"), {
    cache: "no-store"
  })
    .then(r => r.text())
    .then(t => Papa.parse(t, { header: true }).data);

  const missing = [];

  for (const p of planting) {
    if (!p.plantingRef) continue;

    const year = p.plantDate?.substring(0, 4);
    const safeField = safeFieldName(p.field || "");
    const safeRef = safeFileName(p.plantingRef);
    const fileName = `${safeRef}.json`;

    if (!index[safeField] || !index[safeField][year] || !index[safeField][year].includes(fileName)) {
      missing.push(p.plantingRef);
    }
  }

  return missing;
}

/* ---------------------------------------------------------
   3. UI 描画
--------------------------------------------------------- */
function renderMissingList(list) {
  const area = document.getElementById("summaryList");
  area.innerHTML = "";

  if (list.length === 0) {
    area.innerHTML = "<p>すべて生成済みです。</p>";
    return;
  }

  for (const ref of list) {
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
            <span>${ref}</span>
            <button class="btn" data-ref="${ref}">生成</button>
        `;
    area.appendChild(div);
  }

  // 個別生成
  document.querySelectorAll(".btn[data-ref]").forEach(btn => {
    btn.addEventListener("click", () => {
      enqueueSummaryUpdate(btn.dataset.ref);
    });
  });
}

/* ---------------------------------------------------------
   4. すべて生成ボタン
--------------------------------------------------------- */
document.getElementById("generateAll").addEventListener("click", async () => {
  const missing = await getMissingSummaries();

  if (missing.length === 0) {
    alert("未生成のサマリーはありません");
    return;
  }

  // ★ すべて生成の件数と一覧を保存しておく
  window._bulkSummaryList = missing;

  for (const ref of missing) {
    enqueueSummaryUpdate(ref);
  }
});

/* ---------------------------------------------------------
   5. summaryQueueEmpty → すべて生成完了通知
--------------------------------------------------------- */
window.addEventListener("summaryQueueEmpty", () => {
  refreshMissingSummaries();

  // ★ すべて生成のときだけダイアログを出す
  if (window._bulkSummaryList && window._bulkSummaryList.length > 0) {
    const count = window._bulkSummaryList.length;
    const list = window._bulkSummaryList.join("\n");

    alert(
      `すべてのサマリーを生成しました\n\n` +
      `件数: ${count}\n\n` +
      `生成した plantingRef:\n${list}`
    );

    window._bulkSummaryList = null;
  }
});

/* ---------------------------------------------------------
   6. 初期表示
--------------------------------------------------------- */
export function refreshMissingSummaries() {
  setTimeout(async () => {
    const missing = await getMissingSummaries();
    renderMissingList(missing);
  }, 500);
}

refreshMissingSummaries();