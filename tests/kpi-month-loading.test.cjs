const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

class Element {
  constructor(tag = "") {
    this.tag = tag;
    this.children = [];
    this.listeners = {};
    this.attributes = {};
    this.textContent = "";
    this.hidden = false;
  }
  append(...children) {
    for (const child of children) {
      if (child.tag === "fragment") this.children.push(...child.children);
      else this.children.push(child);
    }
  }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  insertRow() { const row = new Element("tr"); this.append(row); return row; }
  createTHead() { const head = new Element("thead"); this.append(head); return head; }
  createTBody() { const body = new Element("tbody"); this.append(body); return body; }
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

async function waitFor(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail("Timed out waiting for KPI rendering");
}

function startPage(salesRequest) {
  const elements = Object.fromEntries([
    "period-from", "period-to", "sales-login", "sales-status", "month-title",
    "apply-period", "kpi-month-body", "kpi-month-total",
  ].map(id => [id, new Element()]));
  const rows = [
    { shippingDate: "2026-11-08", plantingRef: "A", totalWeight: "40", bins: "1" },
    { shippingDate: "2026-11-09", plantingRef: "A", totalWeight: "20", bins: "1" },
  ];
  const context = vm.createContext({
    Node: Element,
    document: {
      getElementById: id => elements[id],
      createElement: tag => new Element(tag),
      createDocumentFragment: () => new Element("fragment"),
      createTextNode: text => ({ textContent: text }),
    },
    location: { search: "?from=2026-11-01&to=2026-11-26", pathname: "/performance/kpi-month.html", hash: "" },
    history: { replaceState() {} },
    URLSearchParams,
    console: { error() {}, warn() {} },
    loadCSV: async () => rows,
    loadJSON: async path => path.includes("summary-index")
      ? { A: { 2026: ["A.json"] } } : { planting: { field: "A", variety: "X" } },
    safeFileName: value => String(value || ""),
    calcAreaTanFromSummaryPlanting: () => 1,
    hasSession: () => true,
    login: async () => {},
    salesApi: () => salesRequest,
    openSettlementPdf: async () => {},
    analyzeSales: (reports, weights, from, to) => ({
      daily: weights.filter(row => row.shippingDate >= from && row.shippingDate <= to).map(row => ({
        ...row, weight: Number(row.totalWeight), bins: Number(row.bins),
        amount: Number(row.totalWeight) * 50, unitPrice: 50, matchStatus: "照合済み",
      })),
    }),
    validateLotRefs() {},
    groupDailyEntries: entries => entries,
  });
  const source = readFileSync(join(__dirname, "..", "deploy", "performance", "kpi-month.js"), "utf8")
    .replace(/^import .*;\s*$/gm, "")
    .replace(/init\(\);\s*$/, "globalThis.finished = init();");
  vm.runInContext(source, context);
  return { elements, finished: context.finished };
}

test("KPI renders before sales loads and preserves period and expanded lot after update", async () => {
  const request = deferred();
  const { elements, finished } = startPage(request.promise);
  await waitFor(() => elements["kpi-month-body"].children.length === 2);
  assert.match(elements["sales-status"].textContent, /読み込み中/);
  let row = elements["kpi-month-body"].children[0];
  assert.equal(row.children[4].textContent, "60");
  assert.equal(row.children[7].textContent, "読込中");
  row.children[0].children[0].listeners.click();

  elements["period-from"].value = "2026-11-08";
  elements["period-to"].value = "2026-11-08";
  await elements["apply-period"].listeners.click();
  request.resolve({ reports: [{}] });
  await finished;
  row = elements["kpi-month-body"].children[0];
  assert.equal(row.children[4].textContent, "40");
  assert.equal(row.children[7].textContent, "2,000円");
  assert.equal(row.children[0].children[0].attributes["aria-expanded"], "true");
  assert.equal(elements["kpi-month-body"].children[1].hidden, false);
  assert.match(elements["month-title"].textContent, /2026-11-08〜2026-11-08/);
});

test("sales failure keeps harvest visible and reports unavailable sales", async () => {
  const request = deferred();
  const { elements, finished } = startPage(request.promise);
  await waitFor(() => elements["kpi-month-body"].children.length === 2);
  request.reject(new Error("通信エラー"));
  await finished;
  const row = elements["kpi-month-body"].children[0];
  assert.equal(row.children[4].textContent, "60");
  assert.equal(row.children[7].textContent, "未確定");
  assert.match(elements["sales-status"].textContent, /取得できません：通信エラー/);
});
