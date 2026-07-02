// =========================================================
// diary/loadDiary.js — 日誌データの読み込み専用
// =========================================================

import { loadJSON } from "/common/json.js";

/**
 * 日付の作業日誌を読み込む
 * @param {string} date - "2026-01-05"
 */
export async function loadDiaryByDate(date) {
  const path = `/diary/data/${date}.json`;
  return await loadJSON(path);
}
