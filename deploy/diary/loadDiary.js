// =========================================================
// diary/loadDiary.js — 日誌データの読み込み専用（404対応）
// =========================================================

import { loadJSON } from "/common/json.js";

/**
 * 日付の作業日誌を読み込む
 * @param {string} date - "2026-07-02"
 */
export async function loadDiaryByDate(date) {
  const path = `/diary/data/${date}.json`;

  try {
    return await loadJSON(path);
  } catch (e) {
    // 404 の場合は「日誌なし」として null を返す
    return null;
  }
}
