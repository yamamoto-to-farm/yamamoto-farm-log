// summary-manager.js — 未生成リストが即時更新される完全版
// CDN 遅延を完全に無視し、UI はローカルで更新する

import { cb, safeFieldName, safeFileName } from "../common/utils.js?v=2026031418";

let currentMissing = [];

/* ---------------------------------------------------------
   1. index.json の読み込み（初回のみ）
--------------------------------------------------------- */
async function loadIndex() {
    try {
        const res = await fetch(cb("../data/summary-index.json"), {
            cache: "no-store"
        });
        if (!res.ok) return {};
        return await res.json();
    } catch {
        return {};
    }
}

/* ---------------------------------------------------------
   2. 未生成チェック（初回のみ）
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

    document.querySelectorAll(".btn[data-ref]").forEach(btn => {
        btn.addEventListener("click", () => {
            enqueueSummaryUpdate(btn.dataset.ref);
        });
    });
}

/* ---------------------------------------------------------
   4. 初期ロード
--------------------------------------------------------- */
export async function refreshMissingSummaries() {
    currentMissing = await getMissingSummaries();
    renderMissingList(currentMissing);
}

refreshMissingSummaries();

/* ---------------------------------------------------------
   5. すべて生成ボタン
--------------------------------------------------------- */
document.getElementById("generateAll").addEventListener("click", async () => {
    if (!currentMissing || currentMissing.length === 0) {
        alert("未生成のサマリーはありません");
        return;
    }

    window._bulkSummaryList = [...currentMissing];

    for (const ref of currentMissing) {
        enqueueSummaryUpdate(ref);
    }
});

/* ---------------------------------------------------------
   6. summaryGenerated → ローカル配列から削除して即時反映
--------------------------------------------------------- */
window.addEventListener("summaryGenerated", (e) => {
    const ref = e.detail.plantingRef;
    if (!ref) return;

    currentMissing = currentMissing.filter(r => r !== ref);
    renderMissingList(currentMissing);
});

/* ---------------------------------------------------------
   7. summaryQueueEmpty → 一括生成完了通知
--------------------------------------------------------- */
window.addEventListener("summaryQueueEmpty", () => {
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