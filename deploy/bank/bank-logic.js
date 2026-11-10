import { annualPeriod, previousPeriodEnd } from "/finance/finance-logic.js?v=20261107-dashboard-1";

export const categories = Object.freeze([
  "売上", "経費", "借入", "借入返済", "口座振替", "現金移動", "その他入金", "その他出金", "未分類",
  "その他事業収入", "固定資産購入", "積立・預け金", "事業主入金", "事業主支出", "決済・内訳確認",
]);

export const subcategories = Object.freeze({
  "売上": ["キャベツ", "その他農産物"],
  "経費": ["種苗費", "肥料費", "農薬費", "資材・消耗品", "燃料費", "雇人費", "専従者給与",
    "修繕費", "保険・共済掛金", "労働保険料", "支払報酬", "支払手数料", "諸会費", "研修費",
    "水利費", "支払利息", "租税公課", "通信費", "作業委託費"],
  "その他事業収入": ["補助金・奨励金", "共済金・保険金", "受託作業収入", "その他"],
  "固定資産購入": ["農業機械", "車両", "設備・施設"],
  "借入": ["事業借入", "つなぎ資金"],
  "借入返済": ["借入元本"],
  "積立・預け金": ["収入保険積立金", "その他積立・預け金"],
  "口座振替": ["自己口座間移動"],
  "現金移動": ["手元現金"],
  "事業主入金": ["個人資金の投入"],
  "事業主支出": ["小規模企業共済（所得控除）", "生活費", "個人の税金・社会保険", "その他"],
  "決済・内訳確認": ["JA請求引落", "カード引落", "ローン・割賦", "内訳待ち"],
});

export function itemParts(item) {
  return item.allocations?.length ? item.allocations : [{
    category: item.category, subcategory: item.subcategory || "", amount: item.deposit + item.withdrawal,
  }];
}

export function validateAllocations(parts, total) {
  if (!Array.isArray(parts) || parts.length < 1 || parts.length > 30
      || parts.some(part => !part || !categories.includes(part.category)
        || typeof part.subcategory !== "string" || part.subcategory.length > 80
        || !Number.isSafeInteger(part.amount) || part.amount <= 0)
      || parts.reduce((sum, part) => sum + part.amount, 0) !== total) {
    throw new Error("内訳は1〜30行、正の整数円で入力し、合計を元の入出金額に一致させてください。");
  }
  return parts;
}

export function allocatedItems(items) {
  return items.flatMap(item => itemParts(item).map(part => ({
    ...item, category: part.category, subcategory: part.subcategory, allocations: [],
    deposit: item.deposit ? part.amount : 0, withdrawal: item.withdrawal ? part.amount : 0,
    review_confirmed: !needsAttention(item),
  })));
}

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
          || !(categories.includes(item.category) || item.category === "内訳分割") || typeof item.review_confirmed !== "boolean"
          || (item.subcategory !== undefined && (typeof item.subcategory !== "string" || item.subcategory.length > 80))) {
        throw new Error("口座明細行の形式が不正です。");
      }
      if (item.allocations !== undefined && !Array.isArray(item.allocations)) throw new Error("口座明細の内訳が不正です。");
      if (item.allocations?.length) {
        validateAllocations(item.allocations, item.deposit + item.withdrawal);
        if (item.category !== "内訳分割" || item.allocations.length < 2) throw new Error("口座明細の分割状態が不正です。");
      } else if (item.category === "内訳分割") throw new Error("口座明細の分割内訳がありません。");
      transactionIds.add(item.transaction_id);
      return { ...item, statement_id: record.statement_id, account_id: record.account_id };
    });
  });
}

export function needsAttention(item) {
  return itemParts(item).some(part => part.category === "未分類") || !item.review_confirmed;
}

export function invoiceLinkStatus(item, link, invoices) {
  if (!link) return "未紐づけ";
  const invoice = invoices.find(value => value.invoice_no === link.invoice_no);
  if (!invoice) return "請求書なし・要再確認";
  const states = [];
  if (invoice.validation_status === "failed") states.push("請求書検証失敗");
  if (invoice.signature !== link.invoice_signature) states.push("請求書更新・要再確認");
  if (invoice.total_amount !== item.withdrawal) states.push("金額差あり");
  return states.join(" ／ ") || "一致";
}

export function jaInvoiceUrl(invoiceNo, item) {
  return `/finance/index.html?source=ja&invoice=${encodeURIComponent(invoiceNo)}&statement=${encodeURIComponent(item.statement_id)}&transaction=${encodeURIComponent(item.transaction_id)}#linked-invoice-panel`;
}

export function invoiceAnalysisItems(items, links, invoices) {
  const notices = [];
  const rows = items.flatMap(item => {
    const matches = links.filter(link => link.statement_id === item.statement_id && link.transaction_id === item.transaction_id);
    if (!matches.length) return [item];
    const link = matches[0], invoice = invoices.find(value => value.invoice_no === link.invoice_no);
    let reason = "";
    if (matches.length !== 1 || link.source !== "ja") reason = "紐づけが不正";
    else if (item.allocations?.length) reason = "手動分割を優先";
    else if (!item.withdrawal || item.deposit) reason = "出金明細ではない";
    else if (!invoice) reason = "請求書なし";
    else if (!["ok", "warning"].includes(invoice.validation_status)) reason = "請求書の検証未完了";
    else if (!invoice.signature || invoice.signature !== link.invoice_signature) reason = "請求書更新・再確認が必要";
    else if (!Number.isSafeInteger(invoice.total_amount) || invoice.total_amount !== item.withdrawal) reason = "請求額と出金額が不一致";
    else if (!Array.isArray(invoice.breakdown) || !invoice.breakdown.length
      || invoice.breakdown.some(part => !Number.isSafeInteger(part.amount) || typeof part.category !== "string"
        || (part.subcategory != null && typeof part.subcategory !== "string"))
      || !Number.isSafeInteger(invoice.breakdown.reduce((sum, part) => sum + part.amount, 0))
      || invoice.breakdown.reduce((sum, part) => sum + part.amount, 0) !== item.withdrawal) reason = "請求書の内訳合計を確認できない";
    if (reason) {
      notices.push({ item, invoice_no: link.invoice_no, reflected: false, reason });
      return [item];
    }
    let reviewCount = 0, unresolvedCount = 0;
    const projected = invoice.breakdown.map(part => {
      const expense = ["肥料費", "農薬費", "資材・消耗品"].includes(part.category);
      const unknown = part.category === "未分類";
      const category = expense ? "経費" : unknown ? "未分類" : "決済・内訳確認";
      const detail = `${part.category}${part.subcategory ? `／${part.subcategory}` : ""}`;
      const subcategory = expense ? detail : unknown ? "JA請求書：未分類" : `JA：${detail}（用途確認）`;
      if (!expense && !unknown) unresolvedCount++;
      const review = unknown || (!expense && !unknown) || Boolean(part.needs_review && part.review_confirmed !== true);
      if (review) reviewCount++;
      return { ...item, category, subcategory, allocations: [], deposit: 0, withdrawal: part.amount,
        review_confirmed: !review };
    });
    notices.push({ item, invoice_no: link.invoice_no, reflected: true, reviewCount, unresolvedCount });
    return projected;
  });
  return { items: rows, notices };
}

export function filterItems(items, { account, from, to, category, subcategory, direction, query, reviewOnly }) {
  const words = (query || "").normalize("NFKC").toLocaleLowerCase("ja").trim().split(/\s+/).filter(Boolean);
  return items.filter(item => (!account || item.account_id === account)
    && (!from || item.trade_date.slice(0, 7) >= from) && (!to || item.trade_date.slice(0, 7) <= to)
    && itemParts(item).some(part => (!category || part.category === category) && (!subcategory || part.subcategory === subcategory))
    && (!direction || (direction === "deposit" ? item.deposit > 0 : item.withdrawal > 0))
    && (!reviewOnly || needsAttention(item))
    && words.every(word => `${item.memo} ${item.note} ${itemParts(item).map(part => `${part.category} ${part.subcategory}`).join(" ")}`.normalize("NFKC").toLocaleLowerCase("ja").includes(word)));
}

export function totals(items) {
  const deposit = items.reduce((sum, item) => sum + item.deposit, 0);
  const withdrawal = items.reduce((sum, item) => sum + item.withdrawal, 0);
  return { deposit, withdrawal, net: deposit - withdrawal };
}

function monthNumber(month) {
  const [year, value] = month.split("-").map(Number);
  return year * 12 + value - 1;
}

function monthLabel(value) {
  return `${Math.floor(value / 12)}-${String(value % 12 + 1).padStart(2, "0")}`;
}

export function statementCoverage(records, account) {
  const selected = records.filter(record => record.account_id === account).sort((a, b) => a.month.localeCompare(b.month));
  if (!selected.length) return null;
  const months = new Set(selected.map(record => record.month));
  const missing = [];
  for (let value = monthNumber(selected[0].month); value <= monthNumber(selected.at(-1).month); value++) {
    if (!months.has(monthLabel(value))) missing.push(monthLabel(value));
  }
  return { start: selected[0].period_start, end: selected.at(-1).period_end, months: [...months], missing };
}

export function balanceTrend(records, { account, from, to }) {
  const selected = records.filter(record => record.account_id === account
    && (!from || record.month >= from) && (!to || record.month <= to)).sort((a, b) => a.month.localeCompare(b.month));
  if (!selected.length) return [];
  const byMonth = new Map(selected.map(record => [record.month, record.closing_balance]));
  const rows = [];
  for (let value = monthNumber(selected[0].month); value <= monthNumber(selected.at(-1).month); value++) {
    const month = monthLabel(value);
    rows.push({ month, balance: byMonth.has(month) ? byMonth.get(month) : null });
  }
  return rows;
}

export function unclassifiedSummary(items) {
  let count = 0, deposit = 0, withdrawal = 0;
  for (const item of items) {
    const amount = itemParts(item).filter(part => part.category === "未分類").reduce((sum, part) => sum + part.amount, 0);
    if (!amount) continue;
    count++;
    if (item.deposit) deposit += amount;
    else withdrawal += amount;
  }
  return { count, deposit, withdrawal };
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

export function sortItems(items, order, category = "") {
  const amount = item => category === "未分類"
    ? itemParts(item).filter(part => part.category === category).reduce((sum, part) => sum + part.amount, 0)
    : item.deposit + item.withdrawal;
  return [...items].sort((a, b) =>
    (order === "amount-desc" ? amount(b) - amount(a) : 0)
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

export function relatedItems(items, selected, query = "", includeClassified = false) {
  const normalize = value => value.normalize("NFKC").replace(/\s+/g, " ").trim();
  const search = normalize(query);
  const memo = normalize(selected.memo);
  if (!memo && !search) return [];
  return sortItems(items.filter(item => item.account_id === selected.account_id
    && !item.allocations?.length
    && (item.deposit > 0) === (selected.deposit > 0)
    && (search ? (includeClassified || item.category === "未分類" && item.classified_by !== "manual") && normalize(item.memo).includes(search)
      : normalize(item.memo) === memo)
    && !(item.statement_id === selected.statement_id && item.transaction_id === selected.transaction_id)), "date-desc");
}

export function annualAnalysis(items, records, account, year, today) {
  const period = annualPeriod(year, today);
  const previous = { start: `${year - 1}-01-01`, end: previousPeriodEnd(period.end) };
  const inPeriod = range => allocatedItems(items).filter(item => (!account || item.account_id === account)
    && item.trade_date >= range.start && item.trade_date <= range.end);
  const currentItems = inPeriod(period);
  const coverage = range => records.filter(record => (!account || record.account_id === account)
    && record.period_start <= range.end && record.period_end >= range.start).map(record => record.month).sort();
  return { period, previous, current: totals(currentItems), prior: totals(inPeriod(previous)),
    months: [...new Set(coverage(period))], priorMonths: [...new Set(coverage(previous))],
    categories: categories.map(category => ({ category, ...totals(currentItems.filter(item => item.category === category)) })) };
}
