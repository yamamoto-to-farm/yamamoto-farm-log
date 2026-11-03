const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const read = file => readFileSync(join(__dirname, "..", "deploy", ...file.split("/")), "utf8");
const strip = source => source.replace(/^import[\s\S]*?;\r?\n/gm, "").replace(/^export /gm, "");
const plan = { off: false, blocks: [{ start: "08:00", end: "15:30", task: "草とり", field: "圃場A" }] };

function screen(role = "admin", deps = {}) {
  const nodes = {};
  const node = () => ({
    textContent: "", innerHTML: "", children: [],
    replaceChildren() { this.textContent = ""; this.innerHTML = ""; this.children = []; },
    append(child) { this.children.push(child); },
  });
  const buttons = [0, 1].map(day => ({
    dataset: { planDay: String(day) }, attributes: {},
    setAttribute(key, value) { this.attributes[key] = value; },
    addEventListener(type, handler) { this[type] = handler; },
  }));
  for (const id of ["ops-schedule-card", "top-plan-body", "top-plan-date", "top-plan-create", "top-plan-hints-body"]) nodes[id] = node();
  nodes["ops-schedule-card"].querySelectorAll = () => buttons;
  const context = vm.createContext({
    console: { error() {}, warn() {} }, URLSearchParams, location: { search: "" },
    window: { currentRole: role }, hasSession: () => true,
    document: { getElementById: id => nodes[id], createElement: node },
    fetchPlannedWork: async () => ({ 担当A: plan }), ...deps,
  });
  vm.runInContext(strip(read("common/date-utils.js")), context);
  vm.runInContext(strip(read("common/top-work-plans.js")), context);
  const start = () => vm.runInContext("initTopWorkPlans(new Date(2026, 11, 31))", context);
  return { context, nodes, buttons, start };
}

test("top switches local today and tomorrow, keeps hints collapsed and passes date to message", async () => {
  const calls = [];
  const { start, nodes, buttons } = screen("family", { fetchPlannedWork: async date => { calls.push(date); return { 担当A: plan }; } });
  await start();
  assert.equal(calls[0], "2026-12-31");
  assert.match(nodes["top-plan-body"].innerHTML, /担当A|草とり/);
  assert.equal(nodes["top-plan-create"].href, "/admin/message/index.html?date=2026-12-31");
  assert.match(nodes["ops-schedule-card"].innerHTML, /<details class="ops-card__section" id="top-plan-hints">/);
  assert.doesNotMatch(nodes["ops-schedule-card"].innerHTML, /日誌|天候/);
  await buttons[1].click();
  assert.equal(calls[1], "2027-01-01");
  assert.equal(nodes["top-plan-create"].href, "/admin/message/index.html?date=2027-01-01");
  assert.equal(buttons[1].attributes["aria-pressed"], "true");
  assert.equal(buttons[0].attributes["aria-pressed"], "false");
});

test("top escapes plans and distinguishes empty plans, cancellation and API errors", async () => {
  const { context, nodes, start } = screen("admin", { fetchPlannedWork: async () => ({}) });
  await start();
  assert.match(nodes["top-plan-body"].innerHTML, /予定は保存されていません/);
  const html = context.topPlansHtml({ "<img>": { off: true, off_reason: "<svg>", blocks: [] } });
  assert.match(html, /中止の連絡/);
  assert.doesNotMatch(html, /<img>|<svg>/);
  context.fetchPlannedWork = async () => { throw new Error("取得失敗"); };
  await start();
  assert.equal(nodes["top-plan-body"].textContent, "取得失敗");
  assert.equal(nodes["top-plan-body"].children[0].textContent, "再試行");
  context.fetchPlannedWork = async () => ({ 担当A: plan });
  await nodes["top-plan-body"].children[0].onclick();
  assert.match(nodes["top-plan-body"].innerHTML, /草とり/);
});

test("top ignores slow old dates and preserves selected day across login", async () => {
  let finish;
  const { context, nodes, buttons, start } = screen("admin", {
    fetchPlannedWork: date => date === "2026-12-31"
      ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({}),
  });
  const pending = start();
  await buttons[1].click();
  finish({ 担当A: plan });
  await pending;
  assert.match(nodes["top-plan-body"].innerHTML, /予定は保存されていません/);
  context.hasSession = () => false;
  let returnTo;
  context.login = value => { returnTo = value; };
  await buttons[1].click();
  await nodes["top-plan-body"].children[0].onclick();
  assert.equal(returnTo, "/index.html?planDate=2027-01-01");
  context.location.search = "?planDate=2027-01-01";
  await start();
  assert.equal(nodes["top-plan-create"].href, "/admin/message/index.html?date=2027-01-01");
});

test("workers never fetch private plans or receive a creation link", async () => {
  const { nodes, start } = screen("worker", { fetchPlannedWork: () => assert.fail("private request") });
  await start();
  assert.doesNotMatch(nodes["ops-schedule-card"].innerHTML, /top-plan-create|data-plan-day|top-plan-body/);
  assert.match(nodes["ops-schedule-card"].innerHTML, /top-plan-hints-body/);
});

test("message honors valid requested dates and otherwise keeps tomorrow default", () => {
  const source = strip(read("admin/message/message.js"));
  const context = vm.createContext({ console: { warn() {} }, URLSearchParams, location: { search: "" } });
  vm.runInContext(strip(read("common/date-utils.js")), context);
  vm.runInContext(source.slice(source.indexOf("function todayIso("), source.indexOf("function dateLabel(")), context);
  for (const date of ["2026-11-04", "2027-01-01", "2028-02-29"]) {
    context.location.search = `?date=${date}`;
    assert.equal(context.initialMessageDate(), date);
  }
  for (const date of ["", "2026-02-30", "invalid", "2026-13-01"]) {
    context.location.search = `?date=${date}`;
    assert.equal(context.initialMessageDate(), context.todayIso(1));
  }
  assert.match(read("admin/message/message.js"), /login\(`\/admin\/message\/index.html\?date=\$\{element\("msg-date"\).value\}`\)/);
});

test("planning hints expose fetch failure and retry rather than empty success", async () => {
  const { context, nodes } = screen();
  const html = read("index.html");
  const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  context.escapeHtml = value => String(value);
  vm.runInContext(script.slice(script.indexOf("    function formatScheduleDate("),
    script.indexOf("    async function loadManagementAlerts(")), context);
  context.loadCSV = async () => { throw Object.assign(new Error("missing"), { status: 404 }); };
  assert.equal((await context.loadPlanningCSV("/test")).length, 0);
  for (const status of [403, 500]) {
    context.loadCSV = async () => { throw Object.assign(new Error("failed"), { status }); };
    await assert.rejects(context.loadPlanningCSV("/test"), /failed/);
  }
  context.loadScheduleStatus = async () => { throw new Error("offline"); };
  context.loadPlantingStatus = async () => [];
  context.loadManagementAlerts = async () => [];
  await context.renderPlanningHints();
  assert.equal(nodes["top-plan-hints-body"].textContent, "確認事項を取得できません。");
  assert.equal(nodes["top-plan-hints-body"].children[0].textContent, "再試行");
  context.loadScheduleStatus = async () => [];
  await nodes["top-plan-hints-body"].children[0].onclick();
  assert.match(nodes["top-plan-hints-body"].innerHTML, /14日以内の定植予定はありません/);
});
