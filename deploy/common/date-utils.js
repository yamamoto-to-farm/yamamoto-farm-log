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

export function localDateValue(value) {
  const date = parseDateInputLocal(value);
  return date ? date.getTime() : 0;
}

export function todayLocalValue(baseDate = new Date()) {
  return localDateValue(todayLocalYmd(baseDate));
}

export function diffDateValuesInDays(later, earlier) {
  const gap = Math.round((Number(later) - Number(earlier)) / 86400000);
  return Number.isFinite(gap) ? gap : null;
}

export function nowJstIso(baseMs = Date.now()) {
  const d = new Date(baseMs + 9 * 60 * 60 * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  const min = String(d.getUTCMinutes()).padStart(2, "0");
  const sec = String(d.getUTCSeconds()).padStart(2, "0");
  return `${y}-${m}-${day}T${h}:${min}:${sec}+09:00`;
}
