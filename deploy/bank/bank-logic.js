import { annualPeriod, previousPeriodEnd } from "/finance/finance-logic.js?v=20261107-dashboard-1";

export const categories = Object.freeze([
  "売上", "経費", "借入", "借入返済", "口座振替", "現金移動", "その他入金", "その他出金", "未分類",
]);

export function flattenStatements(records) {
  const ids = new Set();
  return records.flatMap(record => {
    if (!/^[a-f0-9]{64}$/.test(record.statement_id) || ids.has(record.statement_id)
        || typeof record.revision !== "string" || !record.revision
        || typeof record.account_id !== "string" || !record.account_id
        || typeof record.account_label !== "string"
        || !/^\d{4}-\d{2}$/.test(record.month)
        || !/^\d{4}-\d{2}-\d{2}$/.test(record.period_start) || !record.period_start.startsWith(record.month)
        || !/^\d{4}-\d{2}-\d{2}$/.test(record.period_end) || !record.period_end.startsWith(record.month)
        || !Number.isSafeInteger(record.opening_balance) || !Number.isSafeInteger(record.closing_balance)
        || !Array.isArray(record.warnings) || record.warnings.some(value => typeof value !== "string")
        || !Array.isArray(record.items) || !record.items.length) {
      throw new Error("口座明細データの形式が不正です。");
    }
    ids.add(record.statement_id);
    const transactionIds = new Set();
    return record.items.map(item => {
      if (!/^[a-f0-9]{64}$/.test(item.transaction_id) || transactionIds.has(item.transaction_id)
          || !/^\d{4}-\d{2}-\d{2}$/.test(item.trade_date) || item.trade_date.slice(0, 7) !== record.month
          || ![item.withdrawal, item.deposit].every(value => Number.isSafeInteger(value) && value >= 0)
          || (item.withdrawal > 0) === (item.deposit > 0) || !Number.isSafeInteger(item.balance)
          || typeof item.memo !== "string" || typeof item.note !== "string"
          || !categories.includes(item.category) || typeof item.review_confirmed !== "boolean") {
        throw new Error("口座明細行の形式が不正です。");
      }
      transactionIds.add(item.transaction_id);
      return { ...item, statement_id: record.statement_id, account_id: record.account_id };
    });
  });
}

export function needsAttention(item) {
  return item.category === "未分類" || !item.review_confirmed;
}

export function filterItems(items, { account, from, to, category, direction, query, reviewOnly }) {
  const words = (query || "").normalize("NFKC").toLocaleLowerCase("ja").trim().split(/\s+/).filter(Boolean);
  return items.filter(item => (!account || item.account_id === account)
    && (!from || item.trade_date.slice(0, 7) >= from) && (!to || item.trade_date.slice(0, 7) <= to)
    && (!category || item.category === category)
    && (!direction || (direction === "deposit" ? item.deposit > 0 : item.withdrawal > 0))
    && (!reviewOnly || needsAttention(item))
    && words.every(word => `${item.memo} ${item.note}`.normalize("NFKC").toLocaleLowerCase("ja").includes(word)));
}

export function totals(items) {
  const deposit = items.reduce((sum, item) => sum + item.deposit, 0);
  const withdrawal = items.reduce((sum, item) => sum + item.withdrawal, 0);
  return { deposit, withdrawal, net: deposit - withdrawal };
}

export function monthlyTotals(items, statements, filters) {
  const months = [...new Set(statements.filter(record => (!filters.account || record.account_id === filters.account)
    && (!filters.from || record.month >= filters.from) && (!filters.to || record.month <= filters.to)).map(record => record.month))].sort();
  return months.map(month => {
    const records = statements.filter(record => record.month === month && (!filters.account || record.account_id === filters.account));
    return { month, ...totals(items.filter(item => item.trade_date.startsWith(month))),
      opening: records.length === 1 ? records[0].opening_balance : null,
      closing: records.length === 1 ? records[0].closing_balance : null };
  });
}

export function sortItems(items, order) {
  return [...items].sort((a, b) =>
    (order === "amount-desc" ? b.deposit + b.withdrawal - a.deposit - a.withdrawal : 0)
    || b.trade_date.localeCompare(a.trade_date) || a.statement_id.localeCompare(b.statement_id) || b.line_seq - a.line_seq);
}

export function unclassifiedGroups(items) {
  const groups = new Map();
  for (const item of items) {
    if (item.category !== "未分類" || item.classified_by === "manual") continue;
    const direction = item.deposit ? "入金" : "出金";
    const key = JSON.stringify([item.memo, direction]);
    if (!groups.has(key)) groups.set(key, { memo: item.memo, direction, items: [], total: 0 });
    groups.get(key).items.push(item);
    groups.get(key).total += item.deposit + item.withdrawal;
  }
  return [...groups.values()].sort((a, b) => b.total - a.total);
}

export function relatedItems(items, selected) {
  const memo = selected.memo.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!memo) return [];
  return sortItems(items.filter(item => item.account_id === selected.account_id
    && (item.deposit > 0) === (selected.deposit > 0)
    && item.memo.normalize("NFKC").replace(/\s+/g, " ").trim() === memo
    && !(item.statement_id === selected.statement_id && item.transaction_id === selected.transaction_id)), "date-desc");
}

export function annualAnalysis(items, records, account, year, today) {
  const period = annualPeriod(year, today);
  const previous = { start: `${year - 1}-01-01`, end: previousPeriodEnd(period.end) };
  const inPeriod = range => items.filter(item => (!account || item.account_id === account)
    && item.trade_date >= range.start && item.trade_date <= range.end);
  const currentItems = inPeriod(period);
  const coverage = range => records.filter(record => (!account || record.account_id === account)
    && record.period_start <= range.end && record.period_end >= range.start).map(record => record.month).sort();
  return { period, previous, current: totals(currentItems), prior: totals(inPeriod(previous)),
    months: [...new Set(coverage(period))], priorMonths: [...new Set(coverage(previous))],
    categories: categories.map(category => ({ category, ...totals(currentItems.filter(item => item.category === category)) })) };
}
