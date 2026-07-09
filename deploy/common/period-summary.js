function toDateValue(dateText) {
  const date = new Date(`${dateText}T00:00:00`);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

export function buildPeriodCountSummaryHtml({
  rows = [],
  periodStart = "",
  periodEnd = "",
  countSuffix = "件",
  getDate = row => row?.date
} = {}) {
  const dates = (rows || [])
    .map(row => String(getDate(row) || "").trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  const start = periodStart || dates[0] || "";
  const end = periodEnd || dates[dates.length - 1] || "";
  const suffix = String(countSuffix || "件");

  if (!start || !end) {
    return `表示件数 <strong>${rows.length}</strong>${suffix}`;
  }

  const days = Math.max(1, Math.round((toDateValue(end) - toDateValue(start)) / 86400000) + 1);
  return `${start}〜${end}（<strong>${days}</strong>日間）：<strong>${rows.length}</strong>${suffix}`;
}
