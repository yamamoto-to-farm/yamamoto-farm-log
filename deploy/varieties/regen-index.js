// varieties/regen-index.js
import { loadCSV, normalizeKeys } from "/common/csv.js";
import { loadJSON, saveJSON } from "/common/json.js";
import { safeFileName } from "/common/utils.js";   // ★ 追加

// ★ デバッグフラグ（true にするとログが出る）
const DEBUG = false;

/* ---------------------------------------------------------
   品種インデックス（variety-index.json）再生成
--------------------------------------------------------- */
export async function regenerateVarietyIndex() {

    if (DEBUG) console.log("=== regenerateVarietyIndex() 開始 ===");

    // 1. 定植ログ（CSV）
    let plantingRows = [];
    try {
        const raw = await loadCSV("/logs/planting/all.csv");
        plantingRows = normalizeKeys(raw);
        if (DEBUG) console.log("[DEBUG] plantingRows:", plantingRows);
    } catch (e) {
        console.error("[regen] planting/all.csv 読み込み失敗:", e);
        alert("planting/all.csv が読み込めませんでした");
        return;
    }

    // 2. 新しい variety-index を構築
    const timestamp = new Date().toLocaleString("ja-JP", {
        timeZone: "Asia/Tokyo"
    });

    const varietyIndex = { timestamp };

    if (DEBUG) console.log("[DEBUG] timestamp:", timestamp);

    for (const row of plantingRows) {
        const variety = row.variety || "不明品種";
        const plantingRef = row.plantingRef;
        const seedRef = row.seedRef || null;
        const year = row.plantDate?.substring(0, 4) || "unknown";

        if (!plantingRef) continue;

        if (!varietyIndex[variety]) varietyIndex[variety] = {};
        if (!varietyIndex[variety][year]) {
            varietyIndex[variety][year] = { planting: [], seed: [] };
        }

        // ★★★ ここを safeFileName 化 ★★★
        const fileName = safeFileName(plantingRef) + ".json";

        const exists = varietyIndex[variety][year].planting
            .some(p => p.plantingRef === plantingRef);

        if (!exists) {
            varietyIndex[variety][year].planting.push({
                plantingRef,
                fileName
            });
        }

        if (seedRef && !varietyIndex[variety][year].seed.includes(seedRef)) {
            varietyIndex[variety][year].seed.push(seedRef);
        }
    }

    if (DEBUG) console.log("[DEBUG] 生成された varietyIndex:", varietyIndex);

    // 3. 保存（saveJSON API）
    try {
        await saveJSON("data/variety-index.json", varietyIndex);
        if (DEBUG) console.log("[DEBUG] saveJSON 完了: data/variety-index.json");
        alert("variety-index.json を更新しました");
    } catch (e) {
        console.error("[regen] saveJSON 失敗:", e);
        alert("variety-index.json の保存に失敗しました");
    }

    if (DEBUG) console.log("=== regenerateVarietyIndex() 完了 ===");
}

/* ---------------------------------------------------------
   ボタンセットアップ
--------------------------------------------------------- */
export function setupRegenVarietyIndexButton() {
    const btn = document.getElementById("regen-variety-index");
    if (!btn) return;

    btn.addEventListener("click", async () => {
        if (!confirm("品種インデックス（variety-index.json）を再生成しますか？")) return;

        await regenerateVarietyIndex();
        await showVarietyIndexTimestamp();
    });
}

/* ---------------------------------------------------------
   最終更新日時の表示
--------------------------------------------------------- */
export async function showVarietyIndexTimestamp() {
    try {
        const json = await loadJSON("/data/variety-index.json");

        if (DEBUG) {
            console.log("[DEBUG] 読み込んだ variety-index.json:", json);
            console.log("[DEBUG] timestamp:", json.timestamp);
        }

        const ts = json.timestamp
            ? new Date(json.timestamp).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })
            : "未生成";

        document.getElementById("variety-index-ts").textContent = ts;
    } catch (e) {
        console.error("[DEBUG] timestamp 読み込み失敗:", e);
        document.getElementById("variety-index-ts").textContent = "取得失敗";
    }
}
