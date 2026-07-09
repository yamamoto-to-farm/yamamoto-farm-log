export function formatDateISO(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
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
