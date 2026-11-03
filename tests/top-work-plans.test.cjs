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
  for (const id of ["ops-schedule-card", "top-plan-body", "top-plan-date", "top-plan-create", "top-plan-direct", "top-plan-hints-body"]) nodes[id] = node();
  nodes["ops-schedule-card"].querySelectorAll = () => buttons;
  const context = vm.createContext({
    console: { error() {}, warn() {} }, URLSearchParams, location: { search: "" },
    window: { currentRole: role }, hasSession: () => true,
    document: { getElementById: id => nodes[id], createElement: node },
    fetchWorkPlanRecord: async () => ({ data: { people: { 担当A: plan } } }), ...deps,
  });
  vm.runInContext(strip(read("common/date-utils.js")), context);
  vm.runInContext(strip(read("common/top-work-plans.js")), context);
  const start = () => vm.runInContext("initTopWorkPlans(new Date(2026, 11, 31))", context);
  return { context, nodes, buttons, start };
}

test("top switches local today and tomorrow, keeps hints collapsed and passes date to message", async () => {
  const calls = [];
  const { start, nodes, buttons } = screen("family", { fetchWorkPlanRecord: async date => { calls.push(date); return { data: { people: { 担当A: plan } } }; } });
  await start();
  assert.equal(calls[0], "2026-12-31");
  assert.match(nodes["top-plan-body"].innerHTML, /担当A|草とり/);
  assert.equal(nodes["top-plan-create"].href, "/admin/message/index.html?date=2026-12-31");
  assert.equal(nodes["top-plan-direct"].href, "/schedule/daily-plan/index.html?date=2026-12-31");
  assert.match(nodes["ops-schedule-card"].innerHTML, /<details class="ops-card__section" id="top-plan-hints">/);
  assert.doesNotMatch(nodes["ops-schedule-card"].innerHTML, /日誌|天候/);
  await buttons[1].click();
  assert.equal(calls[1], "2027-01-01");
  assert.equal(nodes["top-plan-create"].href, "/admin/message/index.html?date=2027-01-01");
  assert.equal(nodes["top-plan-direct"].href, "/schedule/daily-plan/index.html?date=2027-01-01");
  assert.equal(buttons[1].attributes["aria-pressed"], "true");
  assert.equal(buttons[0].attributes["aria-pressed"], "false");
});

test("top escapes plans and distinguishes empty plans, cancellation and API errors", async () => {
  const { context, nodes, start } = screen("admin", { fetchWorkPlanRecord: async () => ({ data: { people: {} } }) });
  await start();
  assert.match(nodes["top-plan-body"].innerHTML, /予定は保存されていません/);
  const html = context.topPlansHtml({ "<img>": { off: true, off_reason: "<svg>", blocks: [] } });
  assert.match(html, /中止の連絡/);
  assert.doesNotMatch(html, /<img>|<svg>/);
  context.fetchWorkPlanRecord = async () => { throw new Error("取得失敗"); };
  await start();
  assert.equal(nodes["top-plan-body"].textContent, "取得失敗");
  assert.equal(nodes["top-plan-body"].children[0].textContent, "再試行");
  context.fetchWorkPlanRecord = async () => ({ data: { people: { 担当A: plan } } });
  await nodes["top-plan-body"].children[0].onclick();
  assert.match(nodes["top-plan-body"].innerHTML, /草とり/);
});

test("top ignores slow old dates and preserves selected day across login", async () => {
  let finish;
  const { context, nodes, buttons, start } = screen("admin", {
    fetchWorkPlanRecord: date => date === "2026-12-31"
      ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ data: { people: {} } }),
  });
  const pending = start();
  await buttons[1].click();
  finish({ data: { people: { 担当A: plan } } });
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
  const { nodes, start } = screen("worker", { fetchWorkPlanRecord: () => assert.fail("private request") });
  await start();
  assert.doesNotMatch(nodes["ops-schedule-card"].innerHTML, /top-plan-create|data-plan-day|top-plan-body/);
  assert.match(nodes["ops-schedule-card"].innerHTML, /top-plan-hints-body/);
});
test("top renders one card per original plan rather than personal lunch projections", async () => {
  const saved = { ...plan, names: ["パートA"], recipients: ["パートA"],
    blocks: [{ ...plan.blocks[0], companions: ["家族A"], participation: {
      パートA: [{ start: "08:00", end: "12:00" }, { start: "13:00", end: "15:30" }],
    } }] };
  const { nodes, start } = screen("family", { fetchWorkPlanRecord: async () => ({ data: {
    people: { パートA: { ...saved, blocks: [{ ...saved.blocks[0], end: "12:00" }, { ...saved.blocks[0], start: "13:00" }] },
      家族A: saved }, plans: { one: saved },
  } }) });
  await start();
  const html = nodes["top-plan-body"].innerHTML;
  assert.equal((html.match(/<article/g) || []).length, 1);
  assert.equal((html.match(/草とり/g) || []).length, 1);
  assert.match(html, /<h3>草とり｜圃場A<\/h3>\s*<p>08:00〜15:30<\/p>\s*<p>作業者：パートA・家族A<\/p>/);
  assert.match(html, /08:00〜15:30/);
  assert.doesNotMatch(html, /08:00〜12:00|13:00〜15:30/);
});
test("grouped top cards keep separate plan IDs, scoped workers, cancellation and escaping", () => {
  const { context } = screen();
  const saved = { ...plan, names: ["担当A"], blocks: [
    { ...plan.blocks[0], companions: ["家族A"] },
    { start: "", end: "", task: "潅水", fields: ["圃場B", "圃場C"], companions: ["家族B"] },
  ] };
  const html = context.topPlansHtml({}, { one: saved, two: saved });
  assert.equal((html.match(/<article/g) || []).length, 2);
  assert.match(html, /作業者：担当A・家族A/);
  assert.match(html, /作業者：担当A・家族B/);
  assert.match(html, /潅水｜圃場B・圃場C/);
  const cancelled = context.topPlansHtml({}, { one: { ...saved, names: ["<img>"], off: true, off_reason: "<svg>" } });
  assert.match(cancelled, /中止の連絡/);
  assert.doesNotMatch(cancelled, /<img>|<svg>/);
  assert.match(cancelled, /<h3>草とり｜圃場A<\/h3>/);
  assert.match(html, /<h3>潅水｜圃場B・圃場C<\/h3>\s*<p>時間未指定<\/p>/);
  assert.match(context.topPlansHtml({ ignored: saved }, {}), /予定は保存されていません/);
});
test("top folds only the third and later plans, counting plans rather than task blocks", () => {
  const { context } = screen();
  const saved = { ...plan, names: ["担当A"], blocks: [plan.blocks[0], { ...plan.blocks[0], task: "潅水" }] };
  for (const count of [0, 1, 2, 3, 5]) {
    const plans = Object.fromEntries(Array.from({ length: count }, (_, index) => [`plan-${index}`, saved]));
    const html = context.topPlansHtml({}, plans);
    if (count <= 2) assert.doesNotMatch(html, /top-plan-more|残り/);
    else {
      assert.match(html, new RegExp(`<details class="top-plan-more"><summary>残り${count - 2}件を表示<\\/summary>`));
      assert.equal((html.split('<details class="top-plan-more">')[0].match(/<article/g) || []).length, 2);
      assert.doesNotMatch(html, /<details[^>]* open/);
    }
    assert.equal((html.match(/<article/g) || []).length, count);
  }
  const legacy = context.topPlansHtml({ 担当A: { ...saved, entries: [saved, saved, saved] } });
  assert.match(legacy, /残り1件を表示/);
  const page = read("index.html");
  assert.match(page, /#top-plan-body > \.top-plan-more > summary \{ font-size: 13px/);
  assert.doesNotMatch(page.match(/#top-plan-body \{[^}]+\}/)[0], /max-height|overflow: auto/);
});

test("message honors valid requested dates and otherwise keeps tomorrow default", () => {
  const source = strip(read("admin/message/message.js"));
  const context = vm.createContext({ console: { warn() {} }, URLSearchParams, location: { search: "" } });
  vm.runInContext(strip(read("common/date-utils.js")), context);
  vm.runInContext(source.slice(source.indexOf("function initialMessageDate("), source.indexOf("function syncWorkPlanLink(")), context);
  for (const date of ["2026-11-04", "2027-01-01", "2028-02-29"]) {
    context.location.search = `?date=${date}`;
    assert.equal(context.initialMessageDate(), date);
  }
  for (const date of ["", "2026-02-30", "invalid", "2026-13-01"]) {
    context.location.search = `?date=${date}`;
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    assert.equal(context.initialMessageDate(), `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`);
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
