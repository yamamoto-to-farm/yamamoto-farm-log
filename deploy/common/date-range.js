import { formatLocalYmd } from "./date-utils.js";

export function formatDateISO(date) {
  return formatLocalYmd(date);
}

export function getDefaultPeriodRange(monthsBack = 1, baseDate = new Date()) {
  const end = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
  const start = new Date(end);
  start.setMonth(start.getMonth() - Number(monthsBack || 1));

  return {
    start: formatDateISO(start),
    end: formatDateISO(end)
  };
}
