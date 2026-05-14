// fertilizer/list-utils.js

import { loadJSON } from "/common/json.js?v=1";
import { safeFieldName } from "/common/utils.js?v=1";

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

/* ============================================================
   全圃場の施肥ログを読み込む
   ★ safeFieldName を使ってファイル名を正規化
============================================================ */
export async function loadAllFertilizerLogs() {
  const fieldsData = await loadJSON("/data/fields.json");

  // 圃場名 → safeFieldName に変換
  const fields = fieldsData.map(f => ({
    original: f.name,          // 表示用
    safe: safeFieldName(f.name) // ファイル名用
  }));

  const logs = [];

  for (const f of fields) {
    const path = `/logs/fertilizer/${f.safe}.json`;

    try {
      const data = await loadJSON(path);

      // 年ごとに展開
      for (const year of Object.keys(data.years)) {
        logs.push({
          field: f.original,              // 表示は元の圃場名
          year: Number(year),
          entries: data.years[year].entries
        });
      }

    } catch (e) {
      console.warn(`[fertilizer] No log for field: ${f.original} (${f.safe})`);
    }
  }

  return logs;
}

/* ============================================================
   全ログから存在する年一覧を取得
============================================================ */
export function collectYears(logs) {
  const set = new Set();
  logs.forEach(l => set.add(l.year));
  return Array.from(set).sort((a, b) => b - a);
}
