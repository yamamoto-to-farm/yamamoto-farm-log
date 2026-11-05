const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const { test } = require("node:test");
const vm = require("node:vm");

const root = join(__dirname, "..", "deploy", "finance");
const logic = () => import(pathToFileURL(join(root, "finance-logic.js")).href);
const invoices = [{
  invoice_no: "04026970", issue_date: "2026-10-02", closing_date: "2026-09-30",
  settlement_date: "2026-10-31", forecast_total: 300,
  forecasts: [{ settlement_month: "2026-11", amount: 300 }],
  items: [
    { line_seq: 1, trade_date: "2026-09-01", amount: 100, category: "農薬費",
      item_name: "ザクサ", spec: "5L", department: "第4事業所", needs_review: false },
    { line_seq: 2, trade_date: "2026-09-28", amount: 200, category: "機械部品・装備",
      item_name: "トラクタ部品", spec: "ベアリング", department: "農機課", needs_review: true },
  ],
}];

test("monthly totals use amount columns and switch trade/settlement months", async () => {
  const { flattenItems, monthlyTotals } = await logic();
  const items = flattenItems(invoices);
  assert.deepEqual(monthlyTotals(items, "trade"), [
    { month: "2026-09", total: 300, categories: { "農薬費": 100, "機械部品・装備": 200 } },
  ]);
  assert.equal(monthlyTotals(items, "settlement")[0].month, "2026-10");
  assert.equal(invoices[0].items[0].invoice_no, undefined);
});

test("filters cover date, category, NFKC search, review and machinery", async () => {
  const { flattenItems, filterItems } = await logic();
  const items = flattenItems(invoices);
  assert.equal(filterItems(items, { basis: "trade", from: "2026-10" }).length, 0);
  assert.equal(filterItems(items, { basis: "settlement", from: "2026-10", to: "2026-10" }).length, 2);
  assert.equal(filterItems(items, { basis: "trade", query: "５ｌ", category: "農薬費" }).length, 1);
  assert.equal(filterItems(items, { basis: "trade", query: "ザクサ ５ｌ" }).length, 1);
  assert.equal(filterItems(items, { basis: "trade", machineOnly: true, reviewOnly: true }).length, 1);
});

test("unclassified groups use exact product and department, exclude manual and honor input filters", async () => {
  const { unclassifiedGroups, filterItems } = await logic();
  const base = { item_name: "商品", department: "第4事業所", category: "未分類",
    trade_date: "2026-08-01", spec: "1L", amount: 100 };
  const data = [
    base, { ...base, spec: "5L", amount: -10 },
    { ...base, classified_by: "manual", amount: 9000 },
    { ...base, department: "農機課", amount: 200 },
    { ...base, item_name: "商品A", amount: 300 },
    { ...base, category: "農薬費", amount: 8000 },
    { ...base, trade_date: "2026-09-01", amount: 400 },
  ];
  const groups = unclassifiedGroups(filterItems(data, {basis: "trade", to: "2026-08"}));
  assert.deepEqual(groups.map(group => [group.item_name, group.department, group.total, group.items.length]),
    [["商品A", "第4事業所", 300, 1], ["商品", "農機課", 200, 1], ["商品", "第4事業所", 90, 2]]);
  assert.equal(data.length, 7);
});

test("detail sorting is numeric, stable for ties and does not mutate source", async () => {
  const { sortItems } = await logic();
  const base = { trade_date: "2026-08-01", invoice_no: "sample" };
  const data = [{...base, amount: 90, line_seq: 2}, {...base, amount: 1000, line_seq: 3},
    {...base, amount: -176, line_seq: 1}, {...base, amount: 90, line_seq: 4, trade_date: "2026-09-01"}];
  assert.deepEqual(sortItems(data, "amount-desc").map(item => item.line_seq), [3, 4, 2, 1]);
  assert.deepEqual(sortItems(data, "amount-asc").map(item => item.line_seq), [1, 4, 2, 3]);
  assert.equal(sortItems(data, "date-desc")[0].line_seq, 4);
  assert.equal(data[0].line_seq, 2);
});

test("month selection applies both month bounds, amount order, clears detail toggles and guards busy", () => {
  const { context, element } = setup();
  element("details-section").scrollIntoView = () => { context.scrolled = true; };
  element("review-only").checked = element("machine-only").checked = true;
  vm.runInContext('render = () => {}; page = 3; selectMonth("2026-08")', context);
  assert.equal(element("from").value, "2026-08");
  assert.equal(element("to").value, "2026-08");
  assert.equal(element("detail-sort").value, "amount-desc");
  assert.equal(element("review-only").checked, false);
  assert.equal(element("machine-only").checked, false);
  assert.equal(vm.runInContext("page", context), 0);
  assert.equal(context.scrolled, true);
  vm.runInContext('busy = true; selectMonth("2026-09")', context);
  assert.equal(element("from").value, "2026-08");
});

test("batch classification reports partial saves and retries only unfinished lines", async () => {
  const { context, element, requests } = setup();
  element("edit-category").value = "農薬費";
  element("edit-subcategory").value = "殺虫剤";
  const originalFetch = context.fetch;
  let call = 0;
  context.fetch = async (...args) => {
    call++;
    if (call === 2) throw new Error("offline");
    return originalFetch(...args);
  };
  vm.runInContext(`
    editGroup = {saved: 0, items: [
      {invoice_no: "04026970", line_seq: 1},
      {invoice_no: "03995145", line_seq: 2}
    ]};
    updateButtons = () => {};
    loadData = async () => {};
  `, context);
  await vm.runInContext("saveGroup()", context);
  assert.match(element("edit-status").textContent, /1件保存済み、残り1件.*offline/);
  assert.equal(vm.runInContext("editGroup.items.length", context), 1);
  assert.match(context.lastSaveResult, /1件保存済み、残り1件.*offline/);
  assert.equal(element("save-edit").disabled, false);
  assert.equal(element("edit-category").disabled, false);
  await vm.runInContext("saveGroup()", context);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests.map(request => JSON.parse(request.options.body).invoice_no), ["04026970", "03995145"]);
  assert.equal(JSON.parse(requests[1].options.body).remember, false);
  assert.match(element("status").textContent, /2件の分類を保存/);
  assert.equal(element("edit-dialog").open, false);
  assert.match(context.lastSaveResult, /2件の分類を保存/);
});

test("batch rejects unclassified destination and distinguishes refresh failure after saving", async () => {
  const { context, element, requests } = setup();
  vm.runInContext(`
    editGroup = {saved: 0, items: [{invoice_no: "04026970", line_seq: 1}]};
    updateButtons = () => {};
    loadData = async () => { throw new Error("refresh offline"); };
  `, context);
  element("edit-category").value = "未分類";
  await vm.runInContext("saveGroup()", context);
  assert.equal(requests.length, 0);
  assert.match(element("edit-status").textContent, /分類を選択/);
  element("edit-category").value = "農薬費";
  await vm.runInContext("saveGroup()", context);
  assert.match(element("status").textContent, /1件の分類を保存.*表示の更新に失敗.*refresh offline/);
  assert.equal(vm.runInContext("busy || savingEdit", context), false);
  assert.match(context.lastSaveResult, /保存.*表示の更新に失敗/);
});

test("chart scale uses readable ticks and covers stacked amounts after filtering", async () => {
  const { chartScale } = await logic();
  assert.deepEqual(chartScale([{ categories: { "農薬費": 1843871 } }]), {
    maximum: 2000000, ticks: [0, 500000, 1000000, 1500000, 2000000],
  });
  assert.deepEqual(chartScale([{ categories: { "農薬費": 53000 } }]), {
    maximum: 60000, ticks: [0, 20000, 40000, 60000],
  });
  for (const rows of [[], [{ categories: {} }], [{ categories: { a: 1 } }],
    [{ categories: { a: -176 } }], [{ categories: { a: 100000, b: -176 } }]]) {
    const scale = chartScale(rows);
    assert.ok(scale.maximum >= 1);
    assert.equal(scale.ticks[0], 0);
    assert.equal(scale.ticks.at(-1), scale.maximum);
    assert.ok(scale.ticks.length <= 6);
  }
});

test("chart renders aligned grid positions, scaled bars and empty state", async () => {
  const { context, element } = setup();
  context.chartScale = (await logic()).chartScale;
  const target = element("chart");
  target.append = (...children) => { target.children.push(...children); };
  target.replaceChildren = () => { target.children = []; };
  vm.runInContext(`
    node = (tag, text, className) => ({
      tag, text, className, children: [], style: {},
      append(...children) { this.children.push(...children); },
      setAttribute() {},
      addEventListener() {},
    });
    categories = ["農薬費"];
    formatYen = value => String(value) + "円";
    renderChart([{month: "2026-08", total: 1843871, categories: {"農薬費": 1843871}}]);
  `, context);
  const [axis, plot] = target.children;
  assert.equal(axis.children[1].text, "50万円");
  assert.equal(axis.children[1].style.top, "75%");
  assert.equal(plot.children[0].children[1].style.top, "75%");
  assert.equal(plot.children[1].children[0].children[1].children[0].style.height, "92.19355%");
  vm.runInContext("renderChart([])", context);
  assert.equal(target.children.length, 1);
  assert.equal(target.children[0].text, "対象の明細がありません。");
});

test("forecasts follow issuance, not import order, and do not mutate records", async () => {
  const { latestForecast } = await logic();
  const older = { ...invoices[0], issue_date: "2026-09-02" };
  const records = [older, invoices[0]];
  assert.equal(latestForecast(records), invoices[0]);
  assert.equal(records[0], older);
  assert.equal(latestForecast([]), null);
});

test("failed validation is not presented as an import success", async () => {
  const { uploadOutcome } = await logic();
  assert.equal(uploadOutcome({ validation_status: "failed" }).failed, true);
  assert.match(uploadOutcome({ validation_status: "warning" }).message, /警告/);
});

function setup() {
  const nodes = new Map();
  function element(id) {
    if (!nodes.has(id)) nodes.set(id, {
      hidden: true, value: "", disabled: false, textContent: "",
      classList: { toggle() {} }, querySelectorAll: () => [],
      close() { this.open = false; },
    });
    return nodes.get(id);
  }
  const requests = [];
  const context = vm.createContext({
    showSaveResult: async message => { context.lastSaveResult = message; },
    document: { getElementById: element },
    console: { error() {} },
    ensureToken: async () => "mock-token",
    clearSession() { context.cleared = true; },
    config: { api: "https://example.invalid" },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, status: 200, json: async () => ({}) };
    },
    setTimeout: resolve => resolve(),
  });
  const source = readFileSync(join(root, "finance.js"), "utf8")
    .replace(/^import[\s\S]*?;\r?\n/gm, "")
    .replace(/initialize\(\)\.catch[\s\S]*$/, "");
  vm.runInContext(source, context);
  return { context, element, requests };
}

test("API sends bearer token with no-store and posts only explicit data", async () => {
  const { context, requests } = setup();
  await vm.runInContext('api("/classifications", {invoice_no: "04026970", line_seq: 1})', context);
  assert.equal(requests[0].options.cache, "no-store");
  assert.equal(requests[0].options.headers.Authorization, "Bearer mock-token");
  assert.deepEqual(JSON.parse(requests[0].options.body), { invoice_no: "04026970", line_seq: 1 });
});

test("forecast range and missing credit numbers are displayed without invented values", async () => {
  const { context, element } = setup();
  context.sortItems = (await logic()).sortItems;
  for (const id of ["forecasts", "items"]) {
    const target = element(id);
    target.children = [];
    target.replaceChildren = () => { target.children = []; };
    target.append = (...children) => target.children.push(...children);
  }
  vm.runInContext(`
    node = (tag, text) => ({
      tag, text, children: [],
      append(...children) { this.children.push(...children); },
      addEventListener() {},
    });
    statistic = (label, value) => ({label, value});
    formatYen = value => String(value);
    latestForecast = records => records[0];
    invoices = [{
      issue_date: "2026-09-02", invoice_no: "sample", forecast_total: 117691,
      forecasts: [{settlement_month: "2027-02", amount: 117691, onwards: true}],
    }];
    renderForecasts();
    filteredItems = () => [{
      trade_date: "2026-04-27", invoice_no: "sample", settlement_date: "2026-09-30",
      quantity: null, unit_price: null, amount: -176, item_name: "運賃",
      spec: "", department: "第4事業所", category: "未分類",
    }];
    renderItems();
  `, context);
  assert.equal(element("forecasts").children[0].label, "2027-02以降 決済予定");
  const cells = element("items").children[0].children;
  assert.equal(cells[2].text, "—");
  assert.equal(cells[2].children[0].text, "単価 —");
  assert.equal(cells[3].text, "-176");
});

test("expired login and forbidden access hide financial data", async () => {
  for (const status of [401, 403]) {
    const { context, element } = setup();
    element("data-area").hidden = false;
    context.fetch = async () => ({ ok: false, status });
    await assert.rejects(vm.runInContext('api("/invoices")', context));
    assert.equal(element("data-area").hidden, true);
    if (status === 401) {
      assert.equal(context.cleared, true);
      assert.equal(element("login-area").hidden, false);
    }
  }
});

test("server failures report status and message", async () => {
  const { context } = setup();
  context.fetch = async () => ({
    ok: false, status: 500, text: async () => JSON.stringify({ message: "保存失敗" }),
  });
  await assert.rejects(vm.runInContext('api("/invoices")', context), /500.*保存失敗/);
});

test("successful save with failed refresh explicitly distinguishes the two outcomes", async () => {
  const { context, element, requests } = setup();
  element("edit-category").value = "農薬費";
  element("edit-subcategory").value = "殺虫剤";
  element("keyword").value = "商品";
  vm.runInContext(`
    editItem = {invoice_no: "04026970", line_seq: 1};
    updateButtons = () => {};
    loadData = async () => { throw new Error("offline"); };
  `, context);
  await vm.runInContext("saveEdit({preventDefault(){}})", context);
  assert.equal(requests.length, 1);
  assert.match(element("status").textContent, /分類は保存済み.*更新に失敗.*offline/);
  assert.equal(element("save-edit").disabled, false);
});

test("PDF upload validates file type and measurable size limit before requesting ticket", async () => {
  const { context, element, requests } = setup();
  for (const file of [
    { name: "test.txt", size: 10 },
    { name: "test.pdf", size: 0 },
    { name: "test.pdf", size: 20 * 1024 * 1024 + 1 },
  ]) {
    element("pdf").files = [file];
    await assert.rejects(vm.runInContext("uploadPdf()", context));
  }
  assert.equal(requests.length, 0);
});

test("upload waits for validation, reports failure and preserves existing invoice data", async () => {
  const { context, element } = setup();
  const { uploadOutcome } = await logic();
  const report = {
    import_id: "a".repeat(32), validation_status: "failed",
    validation_errors: ["合計不一致"], warnings: [], unparsed_lines: ["未解析"],
  };
  element("pdf").files = [{ name: "test.pdf", size: 20 * 1024 * 1024 }];
  const fields = [];
  context.FormData = class { append(key, value) { fields.push([key, value]); } };
  context.uploadOutcome = uploadOutcome;
  context.api = async path => {
    if (path === "/uploads") return {
      key: `uploads/${"a".repeat(32)}.pdf`,
      upload: { url: "https://example.invalid/upload", fields: { key: "private-key" } },
    };
    if (path === "/imports") return { imports: [report] };
    return report;
  };
  vm.runInContext("loadData = async () => { globalThis.loaded = true; }; showReport = report => { globalThis.report = report; };", context);
  await vm.runInContext("uploadPdf()", context);
  assert.equal(context.loaded, true);
  assert.equal(context.report.validation_status, "failed");
  assert.match(element("status").textContent, /保留.*\n合計不一致/);
  assert.deepEqual(fields.map(([key]) => key), ["key", "file"]);
  assert.equal(context.report.unparsed_lines.length, 1);
});

test("an uploaded PDF without a completion report is never reported as success", async () => {
  const { context, element } = setup();
  element("pdf").files = [{ name: "test.pdf", size: 10 }];
  context.FormData = class { append() {} };
  let polls = 0;
  context.api = async path => {
    if (path === "/uploads") return {
      key: `uploads/${"a".repeat(32)}.pdf`,
      upload: { url: "https://example.invalid/upload", fields: {} },
    };
    polls++;
    return { imports: [] };
  };
  vm.runInContext("loadData = async () => {};", context);
  await vm.runInContext("uploadPdf()", context);
  assert.equal(polls, 24);
  assert.match(element("status").textContent, /取り込み結果をまだ確認できません/);
  assert.match(element("status").textContent, /再アップロードは不要/);
});

test("page registration is family/admin only and frontend never persists financial records", () => {
  const pages = JSON.parse(readFileSync(join(root, "..", "data", "pages.json"), "utf8"));
  const registration = pages.pages.find(page => page.id === "ja-finance");
  assert.deepEqual(registration.roles, ["family", "admin"]);
  const source = readFileSync(join(root, "finance.js"), "utf8");
  assert.doesNotMatch(source, /localStorage|sessionStorage|innerHTML/);
  assert.match(source, /login\("\/finance\/index.html"\)/);
});
