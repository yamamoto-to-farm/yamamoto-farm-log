// fertilizer/list-utils.js

import { loadJSON } from "/common/json.js?v=1";

/* ============================================================
   肥料マスターを読み込む（共通関数）
============================================================ */
export async function loadFertilizerMaster() {
  return await loadJSON("/data/fertilizer/fertilizer-index.json");
}

/* ============================================================
   ID → 肥料オブジェクト を取得
============================================================ */
export async function getFertilizerById(id) {
  const master = await loadFertilizerMaster();
  return master.find(f => f.id === id) || null;
}

/* ============================================================
   名前 → 肥料オブジェクト を取得
============================================================ */
export async function getFertilizerByName(name) {
  const master = await loadFertilizerMaster();
  return master.find(f => f.name === name) || null;
}
