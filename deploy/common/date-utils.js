// date-utils.js

export function formatLocalYmd(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function todayLocalYmd(baseDate = new Date()) {
  return formatLocalYmd(baseDate);
}

export function parseDateInputLocal(value) {
  const text = String(value || "").trim();
  if (!text) return null;

  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function nowJstIso(baseMs = Date.now()) {
  return new Date(baseMs + 9 * 60 * 60 * 1000).toISOString();
}
