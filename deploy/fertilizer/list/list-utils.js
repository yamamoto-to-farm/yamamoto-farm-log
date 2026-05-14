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

/* ============================================================
   全圃場の施肥ログを読み込む
   /logs/fertilizer/*.json を全部読む
   → 年ごとに展開しやすい構造に変換
============================================================ */
export async function loadAllFertilizerLogs() {
  // 圃場一覧（あなたの OS の fields.json に合わせて変更）
  const fieldsData = await loadJSON("/data/fields.json");
  const fields = fieldsData.fields;

  const logs = [];

  for (const field of fields) {
    const path = `/logs/fertilizer/${field}.json`;

    try {
      const data = await loadJSON(path);

      // 年ごとに展開
      for (const year of Object.keys(data.years)) {
        logs.push({
          field: data.field,
          year: Number(year),
          entries: data.years[year].entries
        });
      }

    } catch (e) {
      console.warn(`[fertilizer] No log for field: ${field}`);
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
