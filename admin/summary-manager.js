// summary-manager.js — 完全修正版（パス修正 + UI描画 + 安全化）

import { cb, safeFieldName, safeFileName } from "../common/utils.js?v=2026031418";

/* ---------------------------------------------------------
   1. index.json の読み込み（キャッシュ無効化）
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

    // 個別生成ボタン
    document.querySelectorAll(".btn[data-ref]").forEach(btn => {
        btn.addEventListener("click", () => {
            const ref = btn.dataset.ref;
            enqueueSummaryUpdate(ref);
        });
    });
}

/* ---------------------------------------------------------
   4. UI 更新（GitHub 反映遅延を吸収）
--------------------------------------------------------- */
export function refreshMissingSummaries() {
    setTimeout(async () => {
        const missing = await getMissingSummaries();
        renderMissingList(missing);
    }, 500);
}

/* ---------------------------------------------------------
   5. summaryQueue が空になったら UI 更新
--------------------------------------------------------- */
window.addEventListener("summaryQueueEmpty", () => {
    refreshMissingSummaries();
});

/* ---------------------------------------------------------
   6. ページ初期表示時にも missing を更新（重要）
--------------------------------------------------------- */
refreshMissingSummaries();