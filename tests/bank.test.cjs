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
    querySelectorAll: () => [], classList: { toggle() {} }, setAttribute(key, value) { this[key] = value; },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    close() { this.closed = true; }, showModal() { this.closed = false; } });
  for (const id of ["login-area", "data-area", "page-area", "status", "account", "from", "to", "category", "direction",
    "query", "review-only", "previous", "next", "edit-category", "edit-note", "edit-confirm", "edit-form", "edit-dialog", "edit-status", "pdf",
    "edit-item", "edit-related", "edit-related-items", "edit-match", "edit-match-count", "chart", "chart-detail", "monthly"]) {
    elements[id] = element();
  }
  elements.account.value = "account-a";
  const c = logic({ document: { getElementById: id => elements[id], createElement: element }, config: { api: "https://api.example.test" },
    ensureToken: async () => "test", clearSession() { c.cleared = true; }, console: { error() {} }, showSaveResult: async () => {},
    ...deps });
  vm.runInContext(strip(read("bank/bank.js")).replace(/initialize\(\)\.catch[\s\S]*$/, ""), c);
  return { c, elements };
}
test("partial memo search only suggests automatic unclassified in the same account and direction", () => {
  const c = logic();
  const base = { ...item({ memo: "10-5 ﾃｽﾄ", category: "未分類" }), account_id: "account-a", statement_id: "a" };
  const match = { ...base, memo: "9-5 テスト", transaction_id: "c", deposit: 200 };
  const rows = [base, match, { ...match, category: "経費" }, { ...match, classified_by: "manual" },
    { ...match, account_id: "other" }, { ...match, deposit: 0, withdrawal: 100 }, { ...match, memo: "9-5 別名" }];
  assert.equal(c.relatedItems(rows, base, "　ﾃｽﾄ ").length, 1);
  assert.equal(c.relatedItems(rows, base).length, 0);
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
test("monthly chart shares finance scale, aligns bar heights, exposes hover and focus amounts and empty state", () => {
  const { c, elements } = screen();
  const rows = [{ month: "2026-01", deposit: 150000, withdrawal: 100000, net: 50000, opening: 0, closing: 50000 }];
  c.renderMonthly(rows);
  const [axis, plot] = elements.chart.children;
  assert.equal(axis.children.length, 4);
  assert.equal(plot.children[0].children.length, 4);
  const button = plot.children[1].children[0];
  assert.equal(button.children[1].children[0].style.height, "100%");
  assert.equal(button.children[1].children[1].style.height, `${100000 / 150000 * 100}%`);
  assert.match(button.children[1].children[0].title, /150,000/);
  button.onmouseenter();
  assert.match(elements["chart-detail"].textContent, /150,000.*100,000/);
  button.onfocus();
  assert.match(elements["chart-detail"].textContent, /2026-01/);
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
  assert.match(html, /<div data-help="入出金グラフの見方">[\s\S]*?残高は絞り込みに関係なく口座全体[\s\S]*?緑：入金 ／ 青：出金[\s\S]*?<\/div>/);
  const between = html.split('<div id="summary"')[1].split('<div id="chart"')[0];
  assert.equal((between.match(/data-help=/g) || []).length, 1);
  assert.doesNotMatch(between, /class="finance-note"/);
  assert.match(html, /id="chart-detail" class="finance-note" aria-live="polite"/);
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
