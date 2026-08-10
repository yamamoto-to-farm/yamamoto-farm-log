// =========================================================
// diary/loadDiary.js — 日誌データの読み込み専用（404対応）
// =========================================================

import { loadJSON } from "/common/json.js";

const diaryCache = new Map();

/**
 * 日付の作業日誌を読み込む
 * @param {string} date - "2026-07-02"
 */
export async function loadDiaryByDate(date) {
  const cacheKey = String(date || "").trim();
  if (!cacheKey) return null;

  if (diaryCache.has(cacheKey)) {
    return diaryCache.get(cacheKey);
  }

  const year = cacheKey.slice(0, 4);
  const path = `/data/diary/${year}/${cacheKey}.json`;

  try {
    const diary = await loadJSON(path);
    diaryCache.set(cacheKey, diary);
    return diary;
  } catch (e) {
    // 404 の場合は「日誌なし」として null を返す
    diaryCache.set(cacheKey, null);
    return null;
  }
}

export function clearDiaryCache(date = "") {
  const cacheKey = String(date || "").trim();
  if (!cacheKey) {
    diaryCache.clear();
    return;
  }

  diaryCache.delete(cacheKey);
}
