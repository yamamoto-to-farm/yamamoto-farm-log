// 写真のカテゴリと定植紐づけの共通ロジック
// カテゴリ: field=圃場 / growth=栽培記録 / work=作業 / issue=被害・異常
import { loadCSV, normalizeKeys } from "/common/csv.js?v=20260821-quote-fix";

export const CATEGORIES = [
  ["field", "圃場"],
  ["growth", "栽培記録"],
  ["work", "作業"],
  ["issue", "被害・異常"],
];
export const CATEGORY_LABEL = Object.fromEntries(CATEGORIES);

let plantingsPromise = null;
function loadPlantings() {
  plantingsPromise ||= loadCSV("/logs/planting/all.csv")
    .then(rows => normalizeKeys(rows))
    .catch(() => []);
  return plantingsPromise;
}

export function daysFromPlanting(plantDate, takenOn) {
  return Math.round((new Date(takenOn) - new Date(plantDate)) / 86400000);
}

// 同じ圃場で「定植日 ≦ 撮影日 ≦ 定植日+240日」の定植を新しい順に最大5件。
// （越冬キャベツは定植9〜10月→収穫が翌年2〜3月になるため約8か月まで候補に含める）
export async function plantingCandidates(field, takenOn) {
  if (!field || !takenOn) return [];
  const rows = await loadPlantings();
  return rows
    .map(row => ({
      ref: String(row.plantingRef || "").trim(),
      variety: String(row.variety || "").trim(),
      plantDate: String(row.plantDate || row.date || "").trim(),
      field: String(row.field || "").trim(),
    }))
    .filter(row => row.ref && row.field === field
      && /^\d{4}-\d{2}-\d{2}$/.test(row.plantDate)
      && row.plantDate <= takenOn
      && daysFromPlanting(row.plantDate, takenOn) <= 240)
    .sort((a, b) => b.plantDate.localeCompare(a.plantDate))
    .slice(0, 5);
}

export function candidateLabel(candidate, takenOn) {
  const [, month, day] = candidate.plantDate.split("-").map(Number);
  return `${candidate.variety || "品種不明"}（${month}/${day}定植・${daysFromPlanting(candidate.plantDate, takenOn)}日目）`;
}

// 写真メタの定植情報の表示文（例: 🌱 NKC-167・定植36日目）
export function plantingText(photo) {
  if (!photo.plantingRef) return "";
  const days = photo.plantDate ? daysFromPlanting(photo.plantDate, photo.takenOn) : null;
  return `🌱 ${photo.variety || "定植"}${days != null && days >= 0 ? `・定植${days}日目` : ""}`;
}
