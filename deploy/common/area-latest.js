function toDateValue(dateText) {
  const date = new Date(`${dateText}T00:00:00`);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

export function getAreaStatusMeta(status) {
  if (status === "in-period") return { label: "期間内あり", className: "in-period" };
  if (status === "out-period") return { label: "期間外のみ", className: "out-period" };
  return { label: "未記録", className: "no-record" };
}

export function buildAreaLatestModel({
  fields = [],
  rows = [],
  periodStart = "",
  periodEnd = "",
  areaSort = "new",
  todayValue,
  getField = row => row?.field,
  getDate = row => row?.date,
  getDateValue = row => row?.dateValue,
  getWorkType = row => row?.workType
} = {}) {
  const now = Number.isFinite(todayValue) ? todayValue : new Date().setHours(0, 0, 0, 0);

  const normalizedRows = (rows || [])
    .map(row => {
      const field = String(getField(row) || "").trim();
      const date = String(getDate(row) || "").trim();
      const dateValueRaw = Number(getDateValue(row));
      const dateValue = Number.isFinite(dateValueRaw) && dateValueRaw > 0 ? dateValueRaw : (date ? toDateValue(date) : 0);
      if (!field || !date || !dateValue) return null;
      return {
        field,
        date,
        dateValue,
        workType: String(getWorkType(row) || "").trim() || "未記録"
      };
    })
    .filter(Boolean);

  const byField = new Map();
  normalizedRows.forEach(row => {
    if (!byField.has(row.field)) byField.set(row.field, []);
    byField.get(row.field).push(row);
  });

  const start = periodStart ? toDateValue(periodStart) : 0;
  const end = periodEnd ? toDateValue(periodEnd) : 0;

  const cards = (fields || []).map(fieldMeta => {
    const fieldName = String(fieldMeta?.name || "").trim();
    const areaName = String(fieldMeta?.area || "").trim();
    const sourceRows = [...(byField.get(fieldName) || [])].sort((a, b) => a.dateValue - b.dateValue);
    const periodRows = sourceRows.filter(row => {
      if (start && row.dateValue < start) return false;
      if (end && row.dateValue > end) return false;
      return true;
    });

    let status = "no-record";
    if (sourceRows.length > 0) {
      status = periodRows.length > 0 ? "in-period" : "out-period";
    }

    const latestAll = sourceRows.length ? sourceRows[sourceRows.length - 1] : null;
    const latestPeriod = periodRows.length ? periodRows[periodRows.length - 1] : null;
    const latestForSort = latestPeriod || latestAll;

    const latestDate = latestForSort?.date || "";
    const latestDateValue = latestForSort?.dateValue || 0;
    const latestAgeDays = latestForSort ? Math.max(0, Math.round((now - latestForSort.dateValue) / 86400000)) : null;

    let latestGapLabel = "初回";
    if (sourceRows.length > 1) {
      const latest = sourceRows[sourceRows.length - 1].dateValue;
      const prev = sourceRows[sourceRows.length - 2].dateValue;
      const gap = Math.max(0, Math.round((latest - prev) / 86400000));
      latestGapLabel = gap === 0 ? "同日" : `${gap}日`;
    }

    return {
      field: fieldName,
      area: areaName,
      status,
      countAll: sourceRows.length,
      countInPeriod: periodRows.length,
      latestDate,
      latestDateValue,
      latestAgeDays,
      latestWorkType: latestForSort?.workType || "未記録",
      latestGapLabel
    };
  });

  const groups = new Map();
  cards.forEach(card => {
    const key = card.area || "その他";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(card);
  });

  const statusOrder = { "in-period": 0, "out-period": 1, "no-record": 2 };

  const areaEntries = [...groups.entries()].map(([areaName, list]) => {
    const inPeriodCount = list.filter(card => card.status === "in-period").length;
    const outPeriodCount = list.filter(card => card.status === "out-period").length;
    const latestCard = [...list].sort((a, b) => b.latestDateValue - a.latestDateValue)[0] || null;

    const groupStatus = inPeriodCount > 0
      ? "in-period"
      : outPeriodCount > 0
        ? "out-period"
        : "no-record";

    const sortedCards = [...list].sort((a, b) => {
      if (a.status !== b.status) return statusOrder[a.status] - statusOrder[b.status];
      if (areaSort === "old") {
        if (a.latestDateValue !== b.latestDateValue) return a.latestDateValue - b.latestDateValue;
      } else {
        if (a.latestDateValue !== b.latestDateValue) return b.latestDateValue - a.latestDateValue;
      }
      return a.field.localeCompare(b.field, "ja");
    });

    return {
      areaName,
      groupStatus,
      cards: sortedCards,
      countAll: list.reduce((sum, card) => sum + card.countAll, 0),
      inPeriodCount,
      outPeriodCount,
      latestDate: latestCard?.latestDate || ""
    };
  });

  areaEntries.sort((a, b) => {
    const av = a.latestDate ? toDateValue(a.latestDate) : 0;
    const bv = b.latestDate ? toDateValue(b.latestDate) : 0;
    if (av !== bv) return areaSort === "old" ? av - bv : bv - av;
    return a.areaName.localeCompare(b.areaName, "ja");
  });

  return {
    areaEntries,
    startLabel: periodStart || "開始日未指定",
    endLabel: periodEnd || "終了日未指定"
  };
}
