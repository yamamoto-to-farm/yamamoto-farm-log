import { loadDiaryByDate, clearDiaryCache } from "./loadDiary.js?v=20261103-status-2";
import { loadLogsByDate, clearWorkSummaryCache } from "./work-summary.js?v=20261103-status-2";

export const diaryStateLabels = Object.freeze({
  saved: "日誌保存済み",
  pending: "作業記録あり",
  empty: "記録なし",
  error: "取得できません",
});

export function diaryState(diary, logs) {
  if (diary !== null) return "saved";
  return logs.length ? "pending" : "empty";
}

export async function loadDiaryStatus(date) {
  const [diary, logs] = await Promise.all([loadDiaryByDate(date), loadLogsByDate(date)]);
  return { ymd: date, state: diaryState(diary, logs), diary, logs, workCount: logs.length };
}

export function clearDiaryStatusCache(date = "") {
  clearDiaryCache(date);
  clearWorkSummaryCache();
}
