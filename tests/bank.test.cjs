const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const read = name => readFileSync(join(__dirname, "..", "deploy", ...name.split("/")), "utf8");
const strip = source => source.replace(/^import[\s\S]*?;\r?\n/gm, "").replace(/^export /gm, "");
function logic(deps = {}) {
  const finance = vm.createContext({});
  vm.runInContext(strip(read("finance/finance-logic.js")), finance);
  const context = vm.createContext({ console, ...deps, annualPeriod: finance.annualPeriod, previousPeriodEnd: finance.previousPeriodEnd,
    formatYen: finance.formatYen, periodPreset: finance.periodPreset, chartScale: finance.chartScale });
  vm.runInContext(strip(read("bank/bank-logic.js")), context);
  return context;
}
const item = (extra = {}) => ({ transaction_id: "b".repeat(64), trade_date: "2026-10-01", withdrawal: 0, deposit: 100,
  balance: 1100, memo: "キャベツ", note: "", category: "売上", classified_by: "rule", review_confirmed: false, line_seq: 1, ...extra });
const record = (extra = {}) => ({ statement_id: "a".repeat(64), account_id: "account-a", account_label: "test ****567",
  revision: '"etag"', month: "2026-10", period_start: "2026-10-01", period_end: "2026-10-31",
  opening_balance: 1000, closing_balance: 1100, warnings: [], items: [item()], ...extra });
const filters = (extra = {}) => ({ account: "account-a", from: "", to: "", category: "", direction: "", query: "", reviewOnly: false, ...extra });
test("bank rows validate identities, dates, amounts and duplicates without silently accepting invalid data", () => {
  const c = logic();
  assert.equal(c.flattenStatements([record()]).length, 1);
  for (const extra of [{ withdrawal: 10 }, { deposit: -1 }, { balance: null }, { trade_date: "2025-10-01" },
    { transaction_id: "../bad" }, { memo: null }, { review_confirmed: "true" }, { category: "unknown" }]) {
    assert.throws(() => c.flattenStatements([record({ items: [item(extra)] })]), /不正/);
  }
  assert.throws(() => c.flattenStatements([record(), record()]), /不正/);
  assert.throws(() => c.flattenStatements([record({ items: [item(), item()] })]), /不正/);
  for (const extra of [{ opening_balance: null }, { closing_balance: "1100" }, { account_id: "" },
    { warnings: null }, { items: [] }, { period_start: "2025-10-01" }]) {
    assert.throws(() => c.flattenStatements([record(extra)]), /不正/);
  }
});
test("frontend and Lambda expose the same categories and existing category order is retained", () => {
  const c = logic();
  const python = readFileSync(join(__dirname, "..", "lambda", "ja-statement-analysis", "bank_statement_parser.py"), "utf8");
  const names = [...python.match(/BANK_CATEGORIES = \(([\s\S]*?)\)/)[1].matchAll(/"([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(Array.from(vm.runInContext("categories", c)), names);
  assert.equal(names.length, 15);
});
test("filtering separates accounts, direction, normalized search, period and review state", () => {
  const c = logic();
  const rows = c.flattenStatements([record({ items: [item(), item({ transaction_id: "c".repeat(64), deposit: 0, withdrawal: 50,
    category: "経費", memo: "ATM Ａ", review_confirmed: true })] })]);
  assert.equal(c.filterItems(rows, filters({ direction: "deposit" })).length, 1);
  assert.equal(c.filterItems(rows, filters({ query: "atm a" })).length, 1);
  assert.equal(c.filterItems(rows, filters({ reviewOnly: true })).length, 1);
  assert.equal(c.filterItems(rows, filters({ account: "other" })).length, 0);
  assert.equal(c.filterItems(rows, filters({ from: "2026-11" })).length, 0);
  assert.equal(c.filterItems(rows, filters({ category: "経費" })).length, 1);
  assert.equal(c.needsAttention(item({ category: "未分類", review_confirmed: true })), true);
});
test("split allocations validate exact sums, preserve parent rows and never double count totals", () => {
  const c = logic();
  const parts = [{ category: "経費", subcategory: "保険・共済掛金", amount: 40 },
    { category: "積立・預け金", subcategory: "収入保険積立金", amount: 60 }];
  const rows = c.flattenStatements([record({ items: [item({ category: "内訳分割", allocations: parts, review_confirmed: true })] })]);
  assert.equal(rows.length, 1);
  const allocated = c.allocatedItems(rows);
  assert.equal(c.totals(allocated).deposit, 100);
  const expense = c.filterItems(allocated, filters({ category: "経費" }));
  assert.equal(c.totals(expense).deposit, 40);
  assert.equal(c.filterItems(rows, filters({ category: "経費" })).length, 1);
  assert.equal(c.filterItems(rows, filters({ category: "経費", subcategory: "収入保険積立金" })).length, 0);
  assert.equal(c.filterItems(rows, filters({ subcategory: "収入保険積立金" })).length, 1);
  assert.equal(c.monthlyTotals(expense, [record()], filters())[0].closing, 1100);
  const annual = c.annualAnalysis(rows, [record()], "account-a", 2026, "2026-11-10");
  assert.equal(annual.current.deposit, 100);
  assert.equal(annual.categories.find(row => row.category === "経費").deposit, 40);
  assert.equal(annual.categories.find(row => row.category === "積立・預け金").deposit, 60);
  assert.equal(c.relatedItems(rows, { ...rows[0], transaction_id: "c".repeat(64) }).length, 0);
  for (const bad of [[], [...parts, parts[0]], [{ ...parts[0], amount: 100.5 }], [{ ...parts[0], amount: -1 }],
    [{ ...parts[0], amount: true }], [{ ...parts[0], amount: 100, subcategory: "x".repeat(81) }], Array(31).fill(parts[0])]) {
    assert.throws(() => c.validateAllocations(bad, 100), /内訳/);
  }
  assert.equal(c.validateAllocations(Array.from({ length: 30 }, () => ({ ...parts[0], amount: 1 })), 30).length, 30);
  assert.throws(() => c.flattenStatements([record({ items: [item({ category: "内訳分割" })] })]), /内訳/);
  assert.throws(() => c.flattenStatements([record({ items: [item({ allocations: parts })] })]), /不正/);
  assert.equal(c.needsAttention({ ...rows[0], allocations: [{ ...parts[0], category: "未分類" }, parts[1]] }), true);
});
test("monthly totals never recompute balances from filtered transactions or combine accounts", () => {
  const c = logic(), rec = record();
  const rows = c.flattenStatements([rec]);
  const month = c.monthlyTotals(c.filterItems(rows, filters({ direction: "withdrawal" })), [rec], filters())[0];
  assert.equal(month.deposit, 0);
  assert.equal(month.net, 0);
  assert.equal(month.opening, 1000);
  assert.equal(month.closing, 1100);
  assert.equal(c.monthlyTotals([], [rec], filters({ from: "2026-11" })).length, 0);
});
test("statement coverage reports account-specific periods and missing months across years", () => {
  const c = logic();
  const records = [record({ month: "2027-02", period_start: "2027-02-01", period_end: "2027-02-28" }),
    record({ month: "2026-12", period_start: "2026-12-01", period_end: "2026-12-31" }),
    record({ account_id: "other", month: "2027-01" })];
  const coverage = c.statementCoverage(records, "account-a");
  assert.equal(coverage.start, "2026-12-01");
  assert.equal(coverage.end, "2027-02-28");
  assert.deepEqual(Array.from(coverage.months), ["2026-12", "2027-02"]);
  assert.deepEqual(Array.from(coverage.missing), ["2027-01"]);
  assert.equal(c.statementCoverage(records, "missing"), null);
});
test("balance trend preserves zero and negative balances, marks missing months and ignores non-period filters", () => {
  const c = logic();
  const records = [record({ month: "2026-01", closing_balance: 0 }), record({ month: "2026-03", closing_balance: -100 }),
    record({ month: "2026-04", closing_balance: 500 }), record({ account_id: "other", month: "2026-02", closing_balance: 999 })];
  const rows = c.balanceTrend(records, filters({ category: "未分類", direction: "deposit", query: "nothing", reviewOnly: true }));
  assert.deepEqual(Array.from(rows, row => [row.month, row.balance]), [["2026-01", 0], ["2026-02", null], ["2026-03", -100], ["2026-04", 500]]);
  assert.equal(c.balanceTrend(records, filters({ from: "2026-03", to: "2026-03" })).length, 1);
  assert.equal(c.balanceTrend(records, filters({ from: "2026-05" })).length, 0);
  assert.equal(c.balanceTrend(records, filters({ from: "2026-04", to: "2026-01" })).length, 0);
});
test("unclassified summary counts parent transactions once and only their unclassified portions", () => {
  const c = logic();
  const rows = [item({ category: "未分類", classified_by: "manual", deposit: 200 }),
    item({ category: "内訳分割", deposit: 0, withdrawal: 1000, allocations: [
      { category: "未分類", subcategory: "", amount: 40 }, { category: "未分類", subcategory: "", amount: 60 },
      { category: "経費", subcategory: "", amount: 900 }] }), item({ category: "経費", review_confirmed: false })];
  const result = c.unclassifiedSummary(rows);
  assert.equal(result.count, 2);
  assert.equal(result.deposit, 200);
  assert.equal(result.withdrawal, 100);
  assert.equal(c.unclassifiedSummary([]).count, 0);
  assert.equal(c.sortItems(rows.slice(0, 2), "amount-desc", "未分類")[0], rows[0]);
  assert.equal(c.sortItems(rows.slice(0, 2), "amount-desc")[0], rows[1]);
});
test("unclassified grouping uses exact memo and direction, never manual-confirmed unclassified", () => {
  const c = logic(), base = item({ category: "未分類", memo: "same", classified_by: "unclassified" });
  const groups = c.unclassifiedGroups([base, { ...base }, { ...base, deposit: 0, withdrawal: 50 },
    { ...base, classified_by: "manual" }, { ...base, memo: "other" }]);
  assert.equal(groups.length, 3);
  assert.equal(groups[0].items.length, 2);
  assert.equal(groups[0].total, 200);
});
test("annual analysis cuts at today, separates incoming/outgoing percentages and clamps leap-day comparison", () => {
  const c = logic();
  const rows = [
    { ...item(), account_id: "account-a", trade_date: "2028-02-29" },
    { ...item({ deposit: 0, withdrawal: 50 }), account_id: "account-a", trade_date: "2028-02-28" },
    { ...item(), account_id: "account-a", trade_date: "2028-03-01" },
    { ...item(), account_id: "other", trade_date: "2028-02-28" },
  ];
  const result = c.annualAnalysis(rows, [], "account-a", 2028, "2028-02-29");
  assert.equal(result.current.deposit, 100);
  assert.equal(result.current.withdrawal, 50);
  assert.equal(result.current.net, 50);
  assert.equal(result.previous.end, "2027-02-28");
  assert.equal(c.annualAnalysis(rows, [], "account-a", 2028, "2029-02-01").current.deposit, 200);
  assert.equal(result.months.length, 0);
});
test("related classification matches normalized exact memo across months, but separates account and direction", () => {
  const c = logic();
  const base = { ...item({ memo: "ﾃﾞﾘｺ ｷｬﾍﾞﾂ" }), account_id: "account-a", statement_id: "a".repeat(64) };
  const related = { ...base, transaction_id: "c".repeat(64), trade_date: "2026-01-05", memo: "デリコ　キャベツ",
    classified_by: "manual", review_confirmed: true, note: "keep" };
  const matches = c.relatedItems([base, related, { ...related, account_id: "other" },
    { ...related, withdrawal: 100, deposit: 0 }, { ...related, memo: "デリコ キャベツ追加" }], base);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].note, "keep");
  assert.equal(c.relatedItems([{ ...related, memo: "" }], { ...base, memo: "" }).length, 0);
});
function screen(deps = {}) {
  const elements = {};
  const element = () => ({ value: "", checked: false, textContent: "", children: [], style: {},
    querySelectorAll: () => [], classList: { toggle() {}, add() {} }, setAttribute(key, value) { this[key] = value; },
    closest() { return this; }, scrollIntoView() { this.scrolled = true; },
    focus() { this.focused = true; },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    close() { this.closed = true; }, showModal() { this.closed = false; } });
  for (const id of ["login-area", "data-area", "page-area", "status", "account", "from", "to", "category", "direction",
    "query", "review-only", "previous", "next", "edit-category", "edit-note", "edit-confirm", "edit-form", "edit-dialog", "edit-status", "pdf",
    "edit-item", "edit-related", "edit-related-items", "edit-match", "edit-match-count", "edit-include-classified", "chart", "chart-detail", "monthly",
    "edit-save-rule", "rule-form", "rules-list", "rule-status", "rule-contains", "rule-category", "rule-direction", "rule-dialog",
    "edit-subcategory", "rule-subcategory", "subcategory", "split-form", "save-split", "split-status", "split-rows",
    "split-item", "split-confirm", "split-total", "split-dialog", "annual", "annual-year", "annual-period",
    "annual-coverage", "annual-comparison", "coverage", "coverage-gaps", "overview", "unclassified-summary",
    "balance-minimum", "chart-mode", "chart-legend", "sort", "details-section", "filter-error", "filter-state",
    "summary", "groups", "groups-attention", "details-attention", "details-query", "details-result", "items", "page-number"]) {
    elements[id] = element();
  }
  elements.account.value = "account-a";
  const c = logic({ document: { getElementById: id => elements[id], createElement: tag => ({ ...element(), tagName: tag }),
    createElementNS: (_namespace, tag) => ({ ...element(), tagName: tag }),
    createTextNode: text => ({ textContent: text }) }, config: { api: "https://api.example.test" },
    todayLocalYmd: () => "2026-11-10",
    ensureToken: async () => "test", clearSession() { c.cleared = true; }, console: { error() {} }, showSaveResult: async () => {},
    ...deps });
  vm.runInContext(strip(read("bank/bank.js")).replace(/initialize\(\)\.catch[\s\S]*$/, ""), c);
  return { c, elements };
}
test("combined SVG breaks lines over missing months, exposes all amounts and supports keyboard drilldown", () => {
  const { c, elements } = screen();
  c.renderCombinedChart([{ month: "2026-01", balance: 500, deposit: 200, withdrawal: 100 }, { month: "2026-02", balance: null, deposit: 0, withdrawal: 0 },
    { month: "2026-03", balance: -100, deposit: 10, withdrawal: 20 }, { month: "2026-04", balance: 0, deposit: 0, withdrawal: 0 }]);
  const svg = elements.chart.children[0];
  const groups = svg.children.filter(child => child.tagName === "g");
  assert.equal(groups[1].children.length, 1);
  assert.equal(groups[0].children.length, 6);
  const points = groups[2].children;
  assert.equal(points.length, 3);
  assert.ok(points.every(point => Number.isFinite(Number(point.cy)) && Number(point.cy) >= 25 && Number(point.cy) <= 205));
  assert.match(elements["balance-minimum"].textContent, /-100.*2026-03/);
  points[1].onmouseenter();
  assert.match(elements["chart-detail"].textContent, /2026-03.*10円.*20円.*-100/);
  points[2].onfocus();
  assert.match(elements["chart-detail"].textContent, /2026-04.*0円/);
  c.selectMonth = month => { c.selectedMonth = month; };
  let prevented = false;
  for (const key of ["Enter", " "]) {
    points[0].onkeydown({ key, preventDefault() { prevented = true; } });
    assert.equal(c.selectedMonth, "2026-01");
    assert.equal(prevented, true);
  }
  for (const balance of [0, -100, 100]) {
    c.renderCombinedChart([{ month: "2026-01", balance, deposit: 0, withdrawal: 0 }]);
    const point = elements.chart.children[0].children.filter(child => child.tagName === "g")[2].children[0];
    assert.ok(Number.isFinite(Number(point.cy)));
  }
  c.renderCombinedChart([]);
  assert.match(elements.chart.children[0].textContent, /ありません/);
  assert.match(elements["balance-minimum"].textContent, /データなし/);
});
test("chart modes switch visible series, legend and scale without changing monthly data", () => {
  const { c, elements } = screen();
  const rows = [{ month: "2026-01", deposit: 150000, withdrawal: 100000, net: 50000, opening: 0, closing: 300000 },
    { month: "2026-02", deposit: 0, withdrawal: 100000, net: -100000, opening: 300000, closing: 200000 }];
  const groups = () => elements.chart.children[0].children.filter(child => child.tagName === "g");
  c.renderMonthly(rows);
  assert.equal(groups()[0].children.length, 4);
  assert.equal(groups()[1].children.length, 1);
  assert.equal(groups()[2].children.length, 2);
  assert.equal(Number(groups()[0].children[0].height), 90);
  elements["chart-mode"].value = "cashflow";
  c.renderMonthly(rows);
  assert.equal(groups()[0].children.length, 4);
  assert.equal(groups()[1].children.length, 0);
  assert.equal(groups()[2].children.length, 0);
  assert.equal(Number(groups()[0].children[0].height), 180);
  assert.doesNotMatch(elements["chart-legend"].textContent, /紫/);
  assert.equal(elements["balance-minimum"].hidden, true);
  assert.match(elements.chart["aria-label"], /入出金/);
  groups()[0].children[0].onfocus();
  assert.match(elements["chart-detail"].textContent, /150,000.*100,000.*300,000/);
  elements["chart-mode"].value = "balance";
  c.renderMonthly(rows);
  assert.equal(groups()[0].children.length, 0);
  assert.equal(groups()[1].children.length, 1);
  assert.equal(groups()[2].children.length, 2);
  assert.equal(Number(groups()[2].children[0].cy), 25);
  assert.doesNotMatch(elements["chart-legend"].textContent, /棒/);
  assert.equal(elements["balance-minimum"].hidden, false);
  elements["chart-mode"].value = "combined";
  c.renderMonthly(rows);
  assert.equal(groups()[0].children.length, 4);
  assert.equal(groups()[2].children.length, 2);
  assert.equal(elements.monthly.children.length, 2);
  elements["chart-mode"].value = "cashflow";
  c.renderMonthly([{ ...rows[0], closing: -300000 }]);
  assert.equal(Number(groups()[0].children[0].height), 180);
  elements["chart-mode"].value = "balance";
  c.renderMonthly([{ ...rows[0], closing: 10000 }]);
  assert.equal(Number(groups()[2].children[0].cy), 25);
  c.renderMonthly([]);
  assert.match(elements.chart.children[0].textContent, /ありません/);
  const html = read("bank/index.html");
  assert.match(html, /id="chart-mode"[\s\S]*value="combined" selected[\s\S]*value="cashflow"[\s\S]*value="balance"/);
  assert.match(read("bank/bank.js"), /el\("chart-mode"\)\.onchange = render/);
});
test("overview shows imported dates, missing months and unclassified amounts; card opens all-period unclassified list", () => {
  const { c, elements } = screen();
  const rec = record({ items: [item({ category: "未分類" })] });
  c.records = [rec, record({ statement_id: "d".repeat(64), month: "2026-08", period_start: "2026-08-01", period_end: "2026-08-31",
    items: [item({ trade_date: "2026-08-01" })] })];
  vm.runInContext("statements = records; items = flattenStatements(records);", c);
  c.render();
  assert.match(elements.coverage.textContent, /2026-08-01.*2026-10-31.*2か月/);
  assert.match(elements["coverage-gaps"].textContent, /2026-09/);
  assert.equal(elements["unclassified-summary"].children[0].children[0].textContent, "1件");
  assert.equal(elements["unclassified-summary"].children[1].children[0].textContent, "100円");
  elements.query.value = "no match";
  c.render();
  const chartGroups = elements.chart.children[0].children.filter(child => child.tagName === "g");
  assert.ok(chartGroups[0].children.every(bar => Number(bar.height) === 0));
  assert.equal(chartGroups[2].children.length, 2);
  assert.ok(chartGroups[2].children.every(point => point["aria-label"].includes("1,100円")));
  elements.from.value = "2026-11";
  elements.query.value = "no match";
  elements["review-only"].checked = true;
  elements["unclassified-summary"].children[0].onclick();
  assert.equal(elements.from.value, "");
  assert.equal(elements.query.value, "");
  assert.equal(elements.category.value, "未分類");
  assert.equal(elements.sort.value, "amount-desc");
  assert.equal(elements["review-only"].checked, false);
  assert.equal(elements["details-section"].open, true);
  assert.equal(elements["details-section"].scrolled, true);
  c.renderAccountOverview([], [], "missing");
  assert.match(elements.coverage.textContent, /ありません/);
  assert.equal(elements["coverage-gaps"].textContent, "");
});
test("detail search syncs both directions, resets paging and clears only search while respecting other filters", () => {
  const { c, elements } = screen();
  c.records = [record({ items: [item({ review_confirmed: true }),
    item({ transaction_id: "c".repeat(64), memo: "共済", category: "経費", deposit: 0, withdrawal: 50 })] })];
  vm.runInContext("statements = records; items = flattenStatements(records); page = 3;", c);
  c.setDetailsQuery("キャベツ");
  assert.equal(elements.query.value, "キャベツ");
  assert.equal(elements["details-query"].value, "キャベツ");
  assert.match(elements["details-result"].textContent, /検索結果 1件.*キャベツ/);
  assert.equal(vm.runInContext("page", c), 0);
  assert.equal(elements.items.children[0].children[1].textContent, "キャベツ");
  elements.query.value = "共済";
  c.render();
  assert.equal(elements["details-query"].value, "共済");
  assert.equal(elements["details-attention"].textContent, "要確認 1件");
  elements.from.value = "2026-10";
  elements.category.value = "経費";
  elements.sort.value = "amount-desc";
  elements["review-only"].checked = true;
  c.setDetailsQuery("");
  assert.equal(elements.query.value, "");
  assert.equal(elements["details-query"].value, "");
  assert.equal(elements.from.value, "2026-10");
  assert.equal(elements.category.value, "経費");
  assert.equal(elements.sort.value, "amount-desc");
  assert.equal(elements["review-only"].checked, true);
  assert.match(elements["details-result"].textContent, /検索結果 1件/);
  c.setDetailsQuery("not found");
  assert.match(elements["details-result"].textContent, /検索結果 0件/);
  c.clearFilters();
  assert.equal(elements["details-query"].value, "");
  assert.match(elements["details-result"].textContent, /検索結果 2件/);
  vm.runInContext("busy = true", c);
  c.setDetailsQuery("ignored");
  assert.equal(elements.query.value, "");
  const html = read("bank/index.html").split('<details id="details-section"')[1].split("</details>")[0];
  assert.match(html, /<h2>取引明細<span data-help=/);
  assert.equal((html.match(/data-help=/g) || []).length, 1);
  assert.match(html, /id="details-query" type="search"/);
  assert.match(html, /id="clear-details-query"/);
  assert.match(read("bank/bank.js"), /el\("details-query"\)\.oninput = .*setDetailsQuery/);
  assert.match(read("bank/bank.js"), /el\("clear-details-query"\)\.onclick = .*setDetailsQuery\(""\)/);
});
test("subcategory candidates use a shared large panel and preserve editable values and disabled guards", () => {
  const { c, elements } = screen();
  const input = elements["edit-subcategory"];
  const panel = c.subcategoryChoices(input);
  assert.equal(panel.tagName, "details");
  assert.equal(panel.className, "bank-subcategory-choices");
  const list = panel.children[1];
  assert.equal(list.className, "bank-subcategory-list");
  const candidate = list.children.find(child => child.tagName === "button" && child.textContent === "保険・共済掛金");
  assert.equal(candidate.type, "button");
  panel.open = true;
  candidate.onclick();
  assert.equal(input.value, "保険・共済掛金");
  assert.equal(panel.open, false);
  assert.equal(input.focused, true);
  input.value = "自由入力";
  input.disabled = true;
  candidate.onclick();
  assert.equal(input.value, "自由入力");
  input.disabled = false;
  vm.runInContext("busy = true", c);
  candidate.onclick();
  assert.equal(input.value, "自由入力");
  const html = read("bank/index.html");
  assert.doesNotMatch(html, /subcategory-suggestions|<datalist/);
  const js = read("bank/bank.js");
  assert.match(js, /input\.parentElement\.after\(subcategoryChoices\(input\)\)/);
  assert.match(js, /detailField\.append\(detail, subcategoryChoices\(detail\)\)/);
  const css = read("bank/bank.css");
  assert.match(css, /\.bank-subcategory-list \{[^}]*max-height: 340px;[^}]*overflow-y: auto/);
  assert.match(css, /\.bank-subcategory-list button \{[^}]*width: 100%;[^}]*min-height: 44px;[^}]*font-size: 16px/);
});
test("annual category tables are collapsed by default independently for incoming and outgoing", () => {
  const { c, elements } = screen();
  c.renderAnnual();
  const parts = elements.annual.children.slice(0, 2);
  assert.equal(parts.length, 2);
  for (const part of parts) {
    const details = part.children.find(child => child.className === "bank-category-details");
    assert.equal(details.tagName, "details");
    assert.notEqual(details.open, true);
    assert.equal(details.children[0].tagName, "summary");
    assert.equal(details.children[0].textContent, "用途別の金額・割合");
    assert.equal(details.children[1].children[0].tagName, "table");
  }
});
test("partial memo search only suggests automatic unclassified in the same account and direction", () => {
  const c = logic();
  const base = { ...item({ memo: "10-5 ﾃｽﾄ", category: "未分類" }), account_id: "account-a", statement_id: "a" };
  const match = { ...base, memo: "9-5 テスト", transaction_id: "c", deposit: 200 };
  const rows = [base, match, { ...match, category: "経費" }, { ...match, classified_by: "manual" },
    { ...match, account_id: "other" }, { ...match, deposit: 0, withdrawal: 100 }, { ...match, memo: "9-5 別名" }];
  assert.equal(c.relatedItems(rows, base, "　ﾃｽﾄ ").length, 1);
  assert.equal(c.relatedItems(rows, base).length, 0);
});
test("opt-in classified partial matches save only selected transactions across months with subcategory and preserved notes", async () => {
  const { c, elements } = screen();
  c.base = { ...item({ memo: "10-5 テスト", category: "経費", classified_by: "manual", review_confirmed: true }),
    account_id: "account-a", statement_id: "a".repeat(64) };
  c.other = { ...c.base, memo: "9-4 ﾃｽﾄ", statement_id: "d".repeat(64),
    transaction_id: "c".repeat(64), subcategory: "旧内訳", note: "keep" };
  c.skipped = { ...c.other, transaction_id: "e".repeat(64), memo: "8-5 テスト" };
  const matching = [c.base, c.other, c.skipped, { ...c.other, account_id: "other" },
    { ...c.other, deposit: 0, withdrawal: 100 }, { ...c.other, allocations: [{ category: "経費", subcategory: "", amount: 100 }] }];
  assert.equal(c.relatedItems(matching, c.base, "テスト").length, 0);
  assert.equal(c.relatedItems(matching, c.base, "テスト", true).length, 2);
  vm.runInContext("items = [base, other, skipped]; statements = [{ statement_id: base.statement_id, revision: 'r1' }, { statement_id: other.statement_id, revision: 'r2' }]", c);
  c.openEdit([c.base]);
  elements["edit-match"].value = "テスト";
  c.renderEditRelated();
  assert.equal(elements["edit-related-items"].children.length, 1);
  assert.match(elements["edit-match-count"].textContent, /分類済み・確認済みも候補/);
  elements["edit-include-classified"].checked = true;
  c.renderEditRelated();
  assert.equal(elements["edit-related-items"].children.length, 3);
  assert.match(elements["edit-related-items"].children[1].children[1].textContent, /旧内訳.*手動修正済み.*確認済み/);
  assert.equal(vm.runInContext("editSelection[1].checkbox.checked", c), false);
  vm.runInContext("editSelection[1].checkbox.checked = true", c);
  c.renderEditRelated();
  assert.equal(vm.runInContext("editSelection[1].checkbox.checked", c), false);
  vm.runInContext("editSelection[1].checkbox.checked = true", c);
  elements["edit-category"].value = "経費";
  elements["edit-subcategory"].value = "雇人費";
  elements["edit-confirm"].checked = true;
  c.loadData = async () => {};
  const requests = [];
  c.api = async (_path, body) => { requests.push(body); return { saved: true, revision: `new-${requests.length}` }; };
  await c.saveEdit({ preventDefault() {} });
  assert.equal(requests.length, 4);
  assert.deepEqual(requests.map(body => body.transaction_id), [c.base.transaction_id, c.base.transaction_id, c.other.transaction_id, c.other.transaction_id]);
  assert.equal(requests[0].subcategory, "雇人費");
  assert.equal(requests[2].subcategory, "雇人費");
  assert.equal(requests[2].note, "keep");
  assert.equal(requests[1].review_confirmed, true);
  assert.equal(requests[3].review_confirmed, true);
  assert.equal(requests[2].revision, "r2");
  c.openEdit([c.base]);
  assert.equal(elements["edit-include-classified"].checked, false);
});
test("changing partial search resets extra choices, preserves primary choice, and shows full memo", () => {
  const { c, elements } = screen();
  c.base = { ...item({ memo: "10-5 名前", category: "未分類" }), account_id: "account-a", statement_id: "a" };
  c.other = { ...c.base, memo: "9-5 名前", transaction_id: "c" };
  vm.runInContext("items = [base, other];", c);
  c.openEdit([c.base]);
  assert.equal(elements["edit-related-items"].children.length, 1);
  elements["edit-match"].value = "名前";
  c.renderEditRelated();
  assert.equal(elements["edit-related-items"].children.length, 2);
  assert.match(elements["edit-related-items"].children[1].children[1].textContent, /9-5 名前/);
  vm.runInContext("editSelection[1].checkbox.checked = true; editSelection[0].checkbox.checked = false;", c);
  c.renderEditRelated();
  assert.equal(vm.runInContext("editSelection.some(choice => choice.checkbox.checked)", c), false);
  vm.runInContext("editStarted = true", c);
  elements["edit-match"].value = "別名";
  c.renderEditRelated();
  assert.equal(elements["edit-related-items"].children.length, 2);
});
test("monthly chart overlays bars and balance on one finance scale and exposes all monthly amounts", () => {
  const { c, elements } = screen();
  const rows = [{ month: "2026-01", deposit: 150000, withdrawal: 100000, net: 50000, opening: 0, closing: 50000 }];
  c.renderMonthly(rows);
  const svg = elements.chart.children[0];
  assert.equal(svg.children.filter(child => child.class === "bank-balance-grid").length, 4);
  const groups = svg.children.filter(child => child.tagName === "g");
  const [incoming, outgoing] = groups[0].children;
  assert.equal(Number(incoming.height), 180);
  assert.equal(Number(outgoing.height), 120);
  assert.equal(Number(groups[2].children[0].cy), 145);
  assert.equal(Number(incoming.x) + 24, Number(groups[2].children[0].cx));
  incoming.onmouseenter();
  assert.match(elements["chart-detail"].textContent, /150,000.*100,000.*50,000/);
  outgoing.onfocus();
  assert.match(elements["chart-detail"].textContent, /2026-01/);
  c.renderMonthly(rows, [{ month: "2026-01", balance: 300000 }]);
  const scaled = elements.chart.children[0].children.filter(child => child.tagName === "g");
  assert.equal(Number(scaled[0].children[0].height), 90);
  assert.equal(Number(scaled[2].children[0].cy), 25);
  assert.equal(elements.monthly.children[0].children[5].textContent, "50,000円");
  c.renderMonthly([]);
  assert.match(elements.chart.children[0].textContent, /ありません/);
});
test("bank API uses private no-store bearer requests and auth failures hide financial data", async () => {
  let request;
  const { c, elements } = screen({ fetch: async (url, options) => { request = { url, options }; return { ok: true, json: async () => ({ saved: true }) }; } });
  await c.api("/classifications", { category: "経費" });
  assert.equal(request.url, "https://api.example.test/bank/classifications");
  assert.equal(request.options.cache, "no-store");
  assert.equal(request.options.headers.Authorization, "Bearer test");
  for (const status of [401, 403]) {
    c.fetch = async () => ({ ok: false, status });
    await assert.rejects(c.api("/statements"));
    assert.equal(elements["data-area"].hidden, true);
    assert.equal(elements["login-area"].hidden, false);
  }
  c.ensureToken = async () => null;
  await assert.rejects(c.api("/statements"), /期限/);
  c.ensureToken = async () => "test";
  c.fetch = async () => ({ ok: false, status: 409, text: async () => '{"message":"変更済み"}' });
  await assert.rejects(c.api("/statements"), /409.*変更済み/);
});
test("bulk save carries forward new revisions and retry addresses only unfinished lines", async () => {
  const { c, elements } = screen();
  const rows = [item(), item({ transaction_id: "c".repeat(64) })].map(row => ({ ...row, statement_id: "a".repeat(64) }));
  c.rows = rows;
  elements["edit-category"].value = "経費";
  c.loadData = async () => {};
  let failed = true;
  const requests = [];
  c.api = async (_path, body) => {
    requests.push(body);
    if (body.transaction_id === "c".repeat(64) && failed) { failed = false; throw new Error("offline"); }
    return { saved: true, revision: '"new-etag"' };
  };
  vm.runInContext('targets = rows; revisions.set("a".repeat(64), \'"original"\');', c);
  await c.saveEdit({ preventDefault() {} });
  assert.equal(vm.runInContext("targets.length", c), 1);
  assert.match(elements["edit-status"].textContent, /1件保存済み・残り1件/);
  await c.saveEdit({ preventDefault() {} });
  assert.equal(requests.length, 3);
  assert.equal(requests[0].revision, '"original"');
  assert.equal(requests[1].revision, '"new-etag"');
  assert.equal(requests[2].transaction_id, "c".repeat(64));
  assert.equal(elements["edit-dialog"].closed, true);
});
test("save success followed by refresh failure is explicit and never becomes unsaved retry", async () => {
  const { c, elements } = screen();
  c.row = { ...item(), statement_id: "a".repeat(64) };
  vm.runInContext('targets = [row]; revisions.set(row.statement_id, \'"original"\');', c);
  c.api = async () => ({ saved: true, revision: '"new"' });
  c.loadData = async () => { throw new Error("offline"); };
  await c.saveEdit({ preventDefault() {} });
  assert.match(elements.status.textContent, /保存済み.*表示更新/);
  assert.equal(vm.runInContext("targets.length", c), 0);
});
test("selected related rows preserve notes and confirmation retries do not repeat classification", async () => {
  const { c, elements } = screen();
  c.primary = { ...item(), statement_id: "a".repeat(64) };
  c.other = { ...item({ transaction_id: "c".repeat(64), note: "keep" }), statement_id: "d".repeat(64) };
  c.excluded = { ...item({ transaction_id: "e".repeat(64) }), statement_id: "a".repeat(64) };
  vm.runInContext(`targets = [primary]; editSelection = [
    {item: primary, checkbox: {checked: true}}, {item: other, checkbox: {checked: true}},
    {item: excluded, checkbox: {checked: false}}];
    revisions.set(primary.statement_id, '"first"'); revisions.set(other.statement_id, '"other"');`, c);
  elements["edit-category"].value = "売上";
  elements["edit-note"].value = "new note";
  elements["edit-confirm"].checked = true;
  c.loadData = async () => {};
  const requests = [];
  let fail = true;
  c.api = async (_path, body) => {
    requests.push(body);
    if (body.review_confirmed && fail) { fail = false; throw new Error("offline"); }
    return { saved: true, revision: `"new-${requests.length}"` };
  };
  await c.saveEdit({ preventDefault() {} });
  assert.match(elements["edit-status"].textContent, /分類保存済み.*確認状態/);
  await c.saveEdit({ preventDefault() {} });
  assert.equal(requests.length, 5);
  assert.equal(requests[0].note, "new note");
  assert.equal(requests[1].review_confirmed, true);
  assert.equal(requests[2].review_confirmed, true);
  assert.equal(requests[2].revision, '"new-1"');
  assert.equal(requests[3].note, "keep");
  assert.equal(requests[3].revision, '"other"');
  assert.equal(requests[4].revision, '"new-4"');
  assert.ok(requests.every(body => body.transaction_id !== c.excluded.transaction_id));
});
test("selection and confirmation validation prevent empty saves or confirmed unclassified", async () => {
  const { c, elements } = screen();
  c.row = item();
  vm.runInContext("targets = [row]; editSelection = [{item: row, checkbox: {checked: false}}]", c);
  c.api = async () => assert.fail("must not save");
  await c.saveEdit({ preventDefault() {} });
  assert.match(elements["edit-status"].textContent, /選択/);
  vm.runInContext("editSelection[0].checkbox.checked = true", c);
  elements["edit-category"].value = "未分類";
  elements["edit-confirm"].checked = true;
  await c.saveEdit({ preventDefault() {} });
  assert.match(elements["edit-status"].textContent, /未分類以外/);
});
test("bulk classification cannot manually hide unknown groups as unclassified", async () => {
  const { c, elements } = screen();
  c.rows = [item(), item()];
  vm.runInContext("targets = rows", c);
  elements["edit-category"].value = "未分類";
  c.api = async () => assert.fail("must not save");
  await c.saveEdit({ preventDefault() {} });
  assert.match(elements["edit-status"].textContent, /未分類以外/);
});
test("upload validates files and never interprets a failed import as success", async () => {
  const { c, elements } = screen({ setTimeout: callback => callback(), FormData: class { append() {} } });
  for (const file of [undefined, { name: "bad.txt", size: 1 }, { name: "big.pdf", size: 21000000 }]) {
    elements.pdf.files = file ? [file] : [];
    await assert.rejects(c.uploadPdf(), /PDF/);
  }
  elements.pdf.files = [{ name: "bank.pdf", size: 100 }];
  c.fetch = async () => ({ ok: true });
  c.api = async path => path === "/uploads"
    ? { key: `bank/uploads/${"a".repeat(32)}.pdf`, upload: { fields: {}, url: "https://upload.example.test" } }
    : { imports: [{ import_id: "a".repeat(32), validation_status: "failed" }] };
  c.loadData = async () => {};
  c.showReport = report => { c.report = report; };
  await c.uploadPdf();
  assert.match(elements.status.textContent, /検証失敗.*保留/);
  assert.equal(c.report.validation_status, "failed");
});
test("upload timeout remains pending, not a success-shaped fallback", async () => {
  const { c, elements } = screen({ setTimeout: callback => callback(), FormData: class { append() {} } });
  elements.pdf.files = [{ name: "bank.pdf", size: 100 }];
  c.fetch = async () => ({ ok: true });
  c.api = async path => path === "/uploads"
    ? { key: `bank/uploads/${"a".repeat(32)}.pdf`, upload: { fields: {}, url: "https://upload.example.test" } }
    : { imports: [] };
  await c.uploadPdf();
  assert.match(elements.status.textContent, /未確認.*再アップロードは不要/);
});
test("monthly graph explanations share one help source while hover amounts remain visible", () => {
  const html = read("bank/index.html");
  assert.match(html, /<div data-help="入出金グラフの見方">[\s\S]*?残高は絞り込みに関係なく口座全体[\s\S]*?共通の金額軸[\s\S]*?<\/div>/);
  assert.match(html, /緑の棒：入金 ／ 青の棒：出金 ／ 紫の線：月末残高/);
  assert.doesNotMatch(html, /id="balance-chart"|id="balance-detail"/);
  const between = html.split('<div id="summary"')[1].split('<div id="chart"')[0];
  assert.equal((between.match(/data-help=/g) || []).length, 1);
  assert.doesNotMatch(between, /class="finance-note"/);
  assert.match(html, /id="chart-detail" class="finance-note" aria-live="polite"/);
});
test("account overview help is a single source immediately after the heading, not below summary cards", () => {
  const section = read("bank/index.html").split('<div id="data-area" hidden>')[1].split("</section>")[0];
  assert.match(section, /<h2>口座の確認<\/h2>\s*<div data-help="口座の確認・集計について">/);
  assert.equal((section.match(/data-help=/g) || []).length, 1);
  const help = section.split('<div data-help=')[1].split("</div>")[0];
  assert.match(help, /月初残高[\s\S]*JA請求書[\s\S]*未分類の件数・金額[\s\S]*未分類部分[\s\S]*元の取引全額/);
  assert.doesNotMatch(help, /class="finance-note"|id="overview"|id="unclassified-summary"/);
  assert.ok(section.indexOf('data-help=') < section.indexOf('id="account"'));
});
test("monthly table is collapsed by default without hiding the graph or changing its table body", () => {
  const html = read("bank/index.html");
  assert.match(html, /<details id="monthly-details">\s*<summary>月別の入出金・残高一覧<\/summary>[\s\S]*?<tbody id="monthly"><\/tbody>[\s\S]*?<\/details>/);
  assert.doesNotMatch(html, /<details[^>]*id="monthly-details"[^>]*\bopen\b/);
  assert.ok(html.indexOf('id="chart"') < html.indexOf('<details id="monthly-details">'));
});
test("related classification help is grouped beside the heading without hiding search or candidate count", () => {
  const section = read("bank/index.html").split('<section id="edit-related" hidden>')[1].split("</section>")[0];
  assert.match(section, /<h3>まとめて変更する明細<\/h3>\s*<div data-help="まとめて変更する明細の使い方">/);
  assert.equal((section.match(/data-help=/g) || []).length, 1);
  assert.doesNotMatch(section, /class="finance-note"/);
  const help = section.split('<div data-help=')[1].split("</div>")[0];
  assert.match(help, /ほかの明細のメモは維持/);
  assert.match(help, /部分一致[\s\S]*手動修正済み[\s\S]*選択は解除[\s\S]*ルールとして保存/);
  assert.doesNotMatch(help, /<input|role="status"/);
  assert.match(section, /<\/div>\s*<label>摘要に含む文字/);
  assert.match(section, /id="edit-match-count" role="status"/);
});
test("optional rule is saved after classifications and failed rule saves retry without repeating rows", async () => {
  const { c, elements } = screen();
  c.base = { ...item(), account_id: "a".repeat(64), statement_id: "b".repeat(64) };
  vm.runInContext("targets=[base]; editPrimary=base; ruleState={rules:[],revision:''};", c);
  elements["edit-category"].value = "経費";
  elements["edit-match"].value = "姓";
  elements["edit-save-rule"].checked = true;
  const requests = [];
  let fail = true;
  c.api = async (path, body) => {
    requests.push({ path, body });
    if (path === "/rules") {
      if (fail) { fail = false; throw new Error("offline"); }
      return { saved: true, revision: "rules-new", rules: [] };
    }
    return { saved: true, revision: "row-new" };
  };
  c.loadData = async () => {};
  await c.saveEdit({ preventDefault() {} });
  assert.match(elements["edit-status"].textContent, /ルールは保存未確認/);
  await c.saveEdit({ preventDefault() {} });
  assert.deepEqual(requests.map(r => r.path), ["/classifications", "/rules", "/rules"]);
  assert.equal(requests[1].body.contains, "姓");
  assert.equal(requests[1].body.direction, "deposit");
});
test("rule management edits and deletes only explicit rules using current revisions", async () => {
  const { c, elements } = screen({ confirm: () => true });
  c.rule = { rule_id: "one", account_id: "account-a", contains: "姓", direction: "withdrawal", category: "経費" };
  vm.runInContext('ruleState={rules:[rule],revision:"original"}', c);
  c.renderRules();
  elements["rules-list"].children[0].children[1].onclick();
  assert.equal(elements["rule-contains"].value, "姓");
  assert.equal(elements["rule-category"].value, "経費");
  elements["rule-contains"].value = "別姓";
  const requests = [];
  c.api = async (path, body) => {
    requests.push({ path, body });
    return { saved: true, revision: "new", rules: body.delete ? [] : [{ ...c.rule, contains: body.contains }] };
  };
  await c.saveRule({ preventDefault() {} });
  assert.equal(requests[0].body.revision, "original");
  assert.equal(requests[0].body.rule_id, "one");
  assert.equal(requests[0].body.contains, "別姓");
  assert.equal(elements["rule-dialog"].closed, true);
  await elements["rules-list"].children[0].children[2].onclick();
  assert.equal(requests[1].body.revision, "new");
  assert.equal(requests[1].body.delete, true);
  assert.match(elements["rules-list"].children[0].textContent, /ありません/);
});
test("split form validates totals, saves atomically and distinguishes post-save refresh errors", async () => {
  const { c, elements } = screen();
  c.base = { ...item(), statement_id: "a".repeat(64) };
  vm.runInContext('splitItem=base; splitRevision="original"; splitRows=[{category:{value:"経費"},detail:{value:"保険料"},amount:{value:"40"}},{category:{value:"積立・預け金"},detail:{value:"積立"},amount:{value:"50"}}]', c);
  c.api = async () => assert.fail("invalid sum must not save");
  await c.saveSplit({ preventDefault() {} });
  assert.match(elements["split-status"].textContent, /一致/);
  vm.runInContext('splitRows[1].amount.value="60"', c);
  elements["split-confirm"].checked = true;
  let payload;
  c.api = async (_path, body) => { payload = body; return { saved: true, revision: "new" }; };
  c.loadData = async () => { throw new Error("offline"); };
  await c.saveSplit({ preventDefault() {} });
  assert.equal(payload.allocations.length, 2);
  assert.equal(payload.review_confirmed, true);
  assert.equal(payload.revision, "original");
  assert.equal(elements["split-dialog"].closed, true);
  assert.match(elements.status.textContent, /内訳は保存済み.*表示更新/);
  c.api = async () => assert.fail("saved rows must not retry");
  await c.saveSplit({ preventDefault() {} });
});
test("split conflict keeps the editor open with its original revision and does not report success", async () => {
  const { c, elements } = screen();
  c.base = { ...item(), statement_id: "a".repeat(64) };
  vm.runInContext('splitItem=base; splitRevision="stale"; splitRows=[{category:{value:"経費"},detail:{value:"燃料費"},amount:{value:"100"}}]', c);
  c.api = async () => { throw new Error("409 changed"); };
  await c.saveSplit({ preventDefault() {} });
  assert.match(elements["split-status"].textContent, /409.*最新データ/);
  assert.equal(vm.runInContext("splitSaved", c), false);
  assert.notEqual(elements["split-dialog"].closed, true);
});
test("bank navigation, finance links, shared styles and closed sections are wired", () => {
  const pages = JSON.parse(read("data/pages.json")).pages;
  const page = pages.find(item => item.id === "bank-statements");
  assert.deepEqual(page.roles, ["family", "admin"]);
  assert.match(read("bank/index.html"), /finance\/finance\.css/);
  assert.match(read("finance/index.html"), /href="\/bank\/index.html"/);
  const html = read("bank/index.html");
  for (const id of ["groups-section", "details-section"]) assert.ok(!new RegExp(`<details[^>]*id="${id}"[^>]*\\bopen\\b`).test(html));
  assert.match(html, /差引は利益ではありません/);
  assert.doesNotMatch(read("bank/bank.js"), /localStorage|sessionStorage|innerHTML/);
});
