const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const read = file => readFileSync(join(__dirname, "..", "deploy", ...file.split("/")), "utf8");
const strip = source => source.replace(/^import[\s\S]*?;\r?\n/gm, "").replace(/^export /gm, "");
function load(file, deps = {}) {
  const context = vm.createContext({ console: { error() {} }, window: { addEventListener() {} }, URLSearchParams, ...deps });
  vm.runInContext(strip(read(file)), context);
  return context;
}
test("direct plans need only assignees and task, with optional multiple fields and paired times", () => {
  const { createDirectPlan: create } = load("schedule/daily-plan/daily-plan.js");
  const plan = create(["担当A"], " 除草剤散布 ", [], "", "", "");
  assert.equal(plan.blocks[0].task, "除草剤散布");
  assert.equal(plan.blocks[0].start, "");
  assert.equal(plan.blocks[0].fields.length, 0);
  assert.equal(plan.source, "direct");
  assert.equal(plan.message, "");
  const multiple = create(["担当A", "担当B"], "耕起", ["圃場A", "圃場B", "圃場A"], "08:00", "12:00", "メモ");
  assert.deepEqual(Array.from(multiple.blocks[0].fields), ["圃場A", "圃場B"]);
  for (const [start, end] of [["08:00", ""], ["", "12:00"], ["12:00", "08:00"], ["25:00", "26:00"]]) {
    assert.throws(() => create(["担当A"], "耕起", [], start, end, ""), /時刻/);
  }
  assert.throws(() => create([], "耕起", [], "", "", ""), /担当者/);
  assert.throws(() => create(["担当A"], "", [], "", "", ""), /作業内容/);
});
test("family selectors use admin/family displays only, with explicit failed loads", async () => {
  const context = load("common/work-plan-form.js", {
    fetch: async () => ({ ok: true, json: async () => [
      { role: "admin", display: "担当A" }, { role: "family", display: "担当B" },
      { role: "worker", display: "パートA" }, { role: "family", display: "担当B" },
    ] }),
  });
  assert.deepEqual(Array.from(await context.loadFamilyWorkers()), ["担当A", "担当B"]);
  context.fetch = async () => ({ ok: false, status: 500 });
  await assert.rejects(context.loadFamilyWorkers(), /500/);
});
test("direct writes preserve revision and report conflicts and uncertain saves", async () => {
  let request;
  const context = load("diary/planned-work.js", {
    config: { api: "https://example.test" }, ensureToken: async () => "test",
    fetch: async (url, options) => {
      request = JSON.parse(options.body);
      return { ok: true, json: async () => ({ saved: true, date: request.date, id: "direct-test" }) };
    },
  });
  await context.writeWorkPlan({ date: "2026-11-04", revision: '"revision"', id: "direct-test", operation: "delete" });
  assert.equal(request.revision, '"revision"');
  assert.equal(request.operation, "delete");
  context.fetch = async () => ({ ok: false, status: 409 });
  await assert.rejects(context.writeWorkPlan({}), /別の端末/);
  context.fetch = async () => ({ ok: true, json: async () => ({ saved: false }) });
  await assert.rejects(context.writeWorkPlan({}), /保存完了/);
});
test("direct entry is registered for family/admin, not workers, and optional fields do not become required", () => {
  const pages = JSON.parse(read("data/pages.json")).pages;
  const page = pages.find(page => page.path === "/schedule/daily-plan/index.html");
  assert.deepEqual(page.roles, ["family", "admin"]);
  const html = read("schedule/daily-plan/index.html");
  assert.doesNotMatch(html, /id="plan-(?:start|end)"[^>]*required/);
  assert.match(html, /id="plan-task"[^>]*required/);
  assert.match(html, /時間・圃場・メモ（任意）/);
  const access = load("common/page-access.js", { URL });
  assert.equal(access.getPageAccess(pages, "/schedule/daily-plan/index.html", "family").allowed, true);
  assert.equal(access.getPageAccess(pages, "/schedule/daily-plan/index.html", "worker").allowed, false);
});

function screen(deps = {}) {
  const nodes = {};
  for (const id of ["plan-date", "plan-inputs", "saved-plans", "message-link", "status", "plan-login",
    "plan-workers", "plan-form", "plan-fields", "editing-label", "custom-task-label", "plan-task",
    "custom-task", "plan-start", "plan-end", "plan-memo", "page-area"]) {
    nodes[id] = {
      value: "", children: [], classList: { toggle() {} }, append(child) { this.children.push(child); },
      replaceChildren() { this.children = []; }, reset() {}, querySelectorAll() { return []; },
    };
  }
  nodes["plan-date"].value = "2026-11-04";
  const context = load("schedule/daily-plan/daily-plan.js", {
    hasSession: () => true, document: { getElementById: id => nodes[id] },
    loadFamilyWorkers: async () => [], getFilterData: () => ({}), setFilterData() {},
    fetch: async () => ({ ok: true, json: async () => [] }),
    fetchWorkPlanRecord: async date => ({ date, revision: '"revision"', data: { date, plans: {}, people: {} } }),
    ...deps,
  });
  return { context, nodes };
}
test("failed direct writes lock saving until reload, preventing duplicate uncertain writes", async () => {
  let writes = 0;
  const { context, nodes } = screen({
    writeWorkPlan: async () => { writes++; throw new Error("offline"); },
  });
  await context.loadDay();
  assert.equal(nodes["plan-inputs"].disabled, false);
  await context.saveRequest({ plan: {} });
  assert.equal(nodes["plan-inputs"].disabled, true);
  assert.equal(nodes["saved-plans"].inert, true);
  assert.match(nodes.status.textContent, /保存状態を確認/);
  await context.saveRequest({ plan: {} });
  assert.equal(writes, 1);
  await context.loadDay();
  assert.equal(nodes["plan-inputs"].disabled, false);
});
test("late direct-plan loads cannot replace a newer selected day", async () => {
  let finish;
  const { context, nodes } = screen({
    fetchWorkPlanRecord: date => date === "2026-11-04"
      ? new Promise(resolve => { finish = resolve; })
      : Promise.resolve({ date, revision: null, data: { date, plans: {}, people: {} } }),
  });
  const first = context.loadDay();
  nodes["plan-date"].value = "2026-11-05";
  await context.loadDay();
  finish({ date: "2026-11-04", revision: null, data: { plans: {} } });
  await first;
  assert.equal(vm.runInContext("record.date", context), "2026-11-05");
  assert.equal(nodes["message-link"].href, "/admin/message/index.html?date=2026-11-05");
});
