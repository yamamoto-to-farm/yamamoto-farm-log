// fertilizer/list-utils.js

import { loadJSON } from "/common/json.js?v=1";
import { safeFieldName } from "/common/utils.js?v=1";

/* ============================================================
   デバッグモード
   true  → ログ出す
   false → ログ出さない
============================================================ */
const DEBUG = false;

function debugLog(...args) {
  if (DEBUG) console.log("[fertilizer]", ...args);
}

function debugWarn(...args) {
  if (DEBUG) console.warn("[fertilizer]", ...args);
}

function debugError(...args) {
  if (DEBUG) console.error("[fertilizer]", ...args);
}

/* ============================================================
   肥料マスターを読み込む（共通関数）
============================================================ */
export async function loadFertilizerMaster() {
  debugLog("Loading fertilizer master…");
  const data = await loadJSON("/data/fertilizer/fertilizer-index.json");
  debugLog("Master loaded:", data);
  return data;
}

/* ============================================================
   ID → 肥料オブジェクト を取得
============================================================ */
export async function getFertilizerById(id) {
  debugLog("getFertilizerById:", id);
  const master = await loadFertilizerMaster();
  const item = master.find(f => f.id === id) || null;
  debugLog(" → result:", item);
  return item;
}

/* ============================================================
   名前 → 肥料オブジェクト を取得
============================================================ */
export async function getFertilizerByName(name) {
  debugLog("getFertilizerByName:", name);
  const master = await loadFertilizerMaster();
  const item = master.find(f => f.name === name) || null;
  debugLog(" → result:", item);
  return item;
}

/* ============================================================
   全圃場の施肥ログを読み込む
   ★ safeFieldName を使ってファイル名を正規化
============================================================ */
export async function loadAllFertilizerLogs() {
  debugLog("Loading all fertilizer logs…");

  const fieldsData = await loadJSON("/data/fields.json");

  const fields = fieldsData.map(f => ({
    original: f.name,
    safe: safeFieldName(f.name)
  }));

  debugLog("Fields:", fields);

  const logs = [];

  for (const f of fields) {
    const path = `/logs/fertilizer/${f.safe}.json`;

    try {
      const data = await loadJSON(path);

      debugLog(`Loaded log for ${f.original} (${f.safe})`, data);

      for (const year of Object.keys(data.years)) {
        logs.push({
          field: f.original,
          year: Number(year),
          entries: data.years[year].entries
        });
      }

    } catch (e) {
      debugWarn(`No log for field: ${f.original} (${f.safe})`);
    }
  }

  debugLog("All logs loaded:", logs);
  return logs;
}

/* ============================================================
   全ログから存在する年一覧を取得
============================================================ */
export function collectYears(logs) {
  debugLog("collectYears:", logs);

  const set = new Set();
  logs.forEach(l => set.add(l.year));

  const years = Array.from(set).sort((a, b) => b - a);

  debugLog(" → years:", years);
  return years;
}
