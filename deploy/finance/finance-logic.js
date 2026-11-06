export const categories = Object.freeze([
  "農薬費", "肥料費", "機械部品・装備", "機械整備工賃", "資材・消耗品", "未分類",
]);

export function formatYen(amount) {
  return `${amount.toLocaleString("ja-JP")}円`;
}

export function flattenItems(invoices) {
  return invoices.flatMap(invoice => invoice.items.map(item => ({
    ...item, invoice_no: invoice.invoice_no, settlement_date: invoice.settlement_date,
  })));
}

export function itemMonth(item, basis) {
  return (basis === "settlement" ? item.settlement_date : item.trade_date).slice(0, 7);
}

export function needsReview(item) {
  return Boolean(item.needs_review && item.review_confirmed !== true);
}

export function annualCategoryTotals(items, today, year = Number(today.slice(0, 4))) {
  const { start, end } = annualPeriod(year, today);
  const totals = new Map(categories.map(category => [category, 0]));
  for (const item of items) {
    if (item.trade_date >= start && item.trade_date <= end) {
      totals.set(item.category, (totals.get(item.category) || 0) + item.amount);
    }
  }
  const rows = [...totals].map(([category, amount]) => ({ category, amount }));
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  const drawable = total > 0 && rows.every(row => row.amount >= 0);
  return { start, end, total, drawable,
    rows: rows.map(row => ({ ...row, percent: drawable ? row.amount / total * 100 : null })) };
}

export function annualPeriod(year, today) {
  const end = year === Number(today.slice(0, 4)) ? today : `${year}-12-31`;
  return { start: `${year}-01-01`, end };
}

export function previousPeriodEnd(end) {
  const year = Number(end.slice(0, 4)) - 1;
  const month = Number(end.slice(5, 7));
  const day = Math.min(Number(end.slice(8, 10)), new Date(Date.UTC(year, month, 0)).getUTCDate());
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function annualComparison(items, today, year) {
  const current = annualCategoryTotals(items, today, year);
  const previousEnd = previousPeriodEnd(current.end);
  const previous = annualCategoryTotals(items, previousEnd);
  const coverage = period => [...new Set(items.filter(item =>
    item.trade_date >= period.start && item.trade_date <= period.end).map(item => item.trade_date.slice(0, 7)))].sort();
  const currentMonths = coverage(current), previousMonths = coverage(previous);
  const difference = currentMonths.length && previousMonths.length ? current.total - previous.total : null;
  return { current, previous, currentMonths, previousMonths, difference,
    percent: difference !== null && previous.total > 0 ? difference / previous.total * 100 : null };
}

export function periodPreset(preset, today) {
  const year = Number(today.slice(0, 4)), month = Number(today.slice(5, 7));
  if (preset === "all") return { from: "", to: "" };
  if (preset === "year") return { from: `${year}-01`, to: today.slice(0, 7) };
  if (preset === "previous-year") return { from: `${year - 1}-01`, to: `${year - 1}-12` };
  if (preset === "previous-month") {
    const previous = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
    return { from: previous, to: previous };
  }
  if (preset === "month") return { from: today.slice(0, 7), to: today.slice(0, 7) };
  throw new Error("期間の指定が不正です。");
}

export function nextForecast(invoices, today) {
  const latest = latestForecast(invoices);
  if (!latest) return null;
  const month = today.slice(0, 7);
  const upcoming = latest.forecasts.filter(item => item.settlement_month >= month)
    .sort((a, b) => a.settlement_month.localeCompare(b.settlement_month));
  if (!upcoming.length) return null;
  const first = upcoming[0];
  return { month: first.settlement_month,
    amount: upcoming.filter(item => item.settlement_month === first.settlement_month).reduce((sum, item) => sum + item.amount, 0),
    onwards: upcoming.some(item => item.settlement_month === first.settlement_month && item.onwards),
    issue_date: latest.issue_date };
}

export function filterItems(items, { basis, from, to, category, query, reviewOnly, machineOnly }) {
  const search = (query || "").normalize("NFKC").toLocaleLowerCase("ja").trim().split(/\s+/).filter(Boolean);
  return items.filter(item => {
    const month = itemMonth(item, basis);
    return (!from || month >= from) && (!to || month <= to)
      && (!category || item.category === category)
      && (!reviewOnly || needsReview(item) || item.category === "未分類")
      && (!machineOnly || item.department === "農機課")
      && search.every(word => `${item.item_name} ${item.spec} ${item.department}`.normalize("NFKC")
        .toLocaleLowerCase("ja").includes(word));
  });
}

export function monthlyTotals(items, basis) {
  const months = new Map();
  for (const item of items) {
    const month = itemMonth(item, basis);
    if (!months.has(month)) months.set(month, { month, total: 0, categories: {} });
    const row = months.get(month);
    row.total += item.amount;
    row.categories[item.category] = (row.categories[item.category] || 0) + item.amount;
  }
  return [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export function latestForecast(invoices) {
  return [...invoices].sort((a, b) => b.issue_date.localeCompare(a.issue_date)
    || b.closing_date.localeCompare(a.closing_date))[0] || null;
}

export function unclassifiedGroups(items) {
  const groups = new Map();
  for (const item of items) {
    if (item.category !== "未分類" || item.classified_by === "manual") continue;
    const key = JSON.stringify([item.item_name, item.department]);
    if (!groups.has(key)) groups.set(key, {
      item_name: item.item_name, department: item.department, total: 0, items: [],
    });
    const group = groups.get(key);
    group.total += item.amount;
    group.items.push(item);
  }
  return [...groups.values()].sort((a, b) => b.total - a.total
    || a.item_name.localeCompare(b.item_name) || a.department.localeCompare(b.department));
}

export function sortItems(items, order) {
  return [...items].sort((a, b) =>
    (order === "amount-desc" ? b.amount - a.amount : order === "amount-asc" ? a.amount - b.amount : 0)
    || b.trade_date.localeCompare(a.trade_date)
    || a.invoice_no.localeCompare(b.invoice_no) || a.line_seq - b.line_seq);
}

export function chartScale(rows) {
  const maximum = Math.max(1, ...rows.map(row =>
    Object.values(row.categories).reduce((sum, amount) => sum + Math.max(0, amount), 0)));
  const rawStep = maximum / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = Math.max(1, [1, 2, 5, 10].find(value => value * magnitude >= rawStep) * magnitude);
  const upper = Math.ceil(maximum / step) * step;
  return { maximum: upper, ticks: Array.from({ length: Math.round(upper / step) + 1 }, (_, index) => index * step) };
}

export function uploadOutcome(report) {
  if (report.validation_status === "failed") {
    return { failed: true, message: "検証に失敗したため、請求書への反映を保留しました。" };
  }
  return {
    failed: false,
    message: report.validation_status === "warning"
      ? "取り込みました。警告内容を確認してください。" : "PDFの取り込みが完了しました。",
  };
}
