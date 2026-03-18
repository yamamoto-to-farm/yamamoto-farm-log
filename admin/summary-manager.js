// summary-manager.js — 安定版（キャッシュ無効化 + 遅延更新 + キュー連携）

import { cb, safeFieldName, safeFileName } from "../common/utils.js?v=2026031418";

/* ---------------------------------------------------------
   1. index.json の読み込み（キャッシュ無効化）
--------------------------------------------------------- */
async function loadIndex() {
    try {
        const res = await fetch(cb("data/summary-index.json") + `?t=${Date.now()}`, {
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

    const planting = await fetch(cb("logs/planting/all.csv") + `?t=${Date.now()}`, {
        cache: "no-store"
    })
        .then(r => r.text())
        .then(t => Papa.parse(t, { header: true }).data);

    const missing = [];

    for (const p of planting) {
        if (!p.plantingRef) continue;

        const year = p.plantDate?.substring(0, 4);
        const safeField = safeFieldName(p.field || "");   // ★ 修正
        const safeRef = safeFileName(p.plantingRef);
        const fileName = `${safeRef}.json`;

        if (!index[safeField] || !index[safeField][year] || !index[safeField][year].includes(fileName)) {
            missing.push(p.plantingRef);
        }
    }

    return missing;
}

/* ---------------------------------------------------------
   3. UI 更新（GitHub 反映遅延を吸収）
--------------------------------------------------------- */
export function refreshMissingSummaries() {
    setTimeout(async () => {
        const missing = await getMissingSummaries();
        renderMissingList(missing);
    }, 500);
}

/* ---------------------------------------------------------
   4. summaryQueue が空になったら UI 更新
--------------------------------------------------------- */
window.addEventListener("summaryQueueEmpty", () => {
    refreshMissingSummaries();
});

/* ---------------------------------------------------------
   5. ページ初期表示時にも missing を更新（重要）
--------------------------------------------------------- */
refreshMissingSummaries();