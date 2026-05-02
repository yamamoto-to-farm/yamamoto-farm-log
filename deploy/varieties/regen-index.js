// varieties/regen-index.js
import { loadCSV, normalizeKeys } from "/common/csv.js";
import { saveJSON } from "/common/json.js";

/* ---------------------------------------------------------
   品種インデックス（variety-index.json）再生成
   ※ planting/all.csv を CSV として読み込む
--------------------------------------------------------- */
export async function regenerateVarietyIndex() {

  // 1. 定植ログ（CSV）
  let plantingRows = [];
  try {
    const raw = await loadCSV("/logs/planting/all.csv");
    plantingRows = normalizeKeys(raw);
  } catch (e) {
    console.error("[regen] planting/all.csv 読み込み失敗:", e);
    alert("planting/all.csv が読み込めませんでした");
    return;
  }

  // 2. 新しい variety-index を構築
  const varietyIndex = {
    timestamp: new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString()
  };

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

    // plantingRef
    if (!varietyIndex[variety][year].planting.includes(plantingRef)) {
      varietyIndex[variety][year].planting.push(plantingRef);
    }

    // seedRef（あれば）
    if (seedRef && !varietyIndex[variety][year].seed.includes(seedRef)) {
      varietyIndex[variety][year].seed.push(seedRef);
    }
  }

  // 3. 保存（saveJSON API）
  try {
    await saveJSON("data/variety-index.json", varietyIndex);
    alert("variety-index.json を更新しました");
  } catch (e) {
    console.error("[regen] saveJSON 失敗:", e);
    alert("variety-index.json の保存に失敗しました");
  }
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
    const ts = json.timestamp
      ? new Date(json.timestamp).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })
      : "未生成";

    document.getElementById("variety-index-ts").textContent = ts;
  } catch {
    document.getElementById("variety-index-ts").textContent = "取得失敗";
  }
}
