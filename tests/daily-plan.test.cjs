const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const read = file => readFileSync(join(__dirname, "..", "deploy", ...file.split("/")), "utf8");
const strip = source => source.replace(/^import[\s\S]*?;\r?\n/gm, "").replace(/^export /gm, "");
function load(file, deps = {}) {
  const context = vm.createContext({ console: { error() {}, warn() {} }, structuredClone,
    window: { addEventListener() {} }, URLSearchParams, ...deps });
  vm.runInContext(strip(read(file)), context);
  return context;
}
const block = { task: "耕起", fields: [], start: "", end: "", shed: false };
test("unified plans cover family-only, part-only, mixed groups and multiple optional-time tasks", () => {
  const { createUnifiedPlan: create } = load("schedule/daily-plan/daily-plan.js");
  const family = create(["家族A"], [], [block], "");
  assert.deepEqual(Array.from(family.names), ["家族A"]);
  assert.equal(family.recipients.length, 0);
  assert.equal(family.kind, "1");
  const part = create([], ["パートA"], [block], "");
  assert.equal(part.kind, "3");
  const parts = create([], ["パートA", "パートB"], [block], "", "パートB");
  assert.equal(parts.kind, "2");
  assert.equal(parts.reporter, "パートB");
  const mixed = create(["家族A", "家族B"], ["パートA"], [{ ...block, companions: ["家族A"] },
    { ...block, task: "除草剤散布", fields: ["圃場A", "圃場B"], companions: ["家族B"] }], "");
  assert.equal(mixed.kind, "1");
  assert.deepEqual(Array.from(mixed.blocks[0].companions), ["家族A"]);
  assert.deepEqual(Array.from(mixed.blocks[1].companions), ["家族B"]);
  assert.equal(mixed.blocks[0].start, "");
  assert.throws(() => create([], [], [block], ""), /作業者/);
  assert.throws(() => create([], ["パートA", "パートB"], [block], ""), /連絡係/);
  assert.throws(() => create(["家族A"], [], [{ ...block, start: "08:00" }], ""), /時刻/);
});
test("cancellation preserves tasks, supports old message edits and separate sources", () => {
  const { createUnifiedPlan: create } = load("schedule/daily-plan/daily-plan.js");
  const cancelled = create(["家族A"], ["パートA"], [block], "", "", true, "雨天", "message");
  assert.equal(cancelled.off, true);
  assert.equal(cancelled.source, "message");
  assert.equal(cancelled.blocks[0].task, "耕起");
  assert.equal(cancelled.message, "");
});
function screen(deps = {}) {
  const nodes = {};
  const ids = ["plan-date", "plan-inputs", "saved-plans", "message-link", "status", "plan-login", "plan-workers",
    "plan-parts", "participant-kind", "plan-form", "plan-blocks", "editing-label", "plan-memo", "page-area",
    "plan-reporter", "plan-off", "plan-off-reason", "communication-history", "shift-candidates", "shift-state", "work-plan-link",
    "plan-kind", "family-group", "parts-group", "parts-shift-note", "reporter-group"];
  for (const id of ids) nodes[id] = { value: "", checked: false, children: [], innerHTML: "",
    classList: { toggle() {} }, replaceChildren() { this.children = []; }, reset() {}, scrollIntoView() {} };
  nodes["plan-date"].value = "2026-11-04";
  const context = load("schedule/daily-plan/daily-plan.js", {
    hasSession: () => true, document: { getElementById: id => nodes[id] }, confirm: () => true,
    loadPlanWorkers: async () => [], getFilterData: () => ({}), setFilterData() {},
    fetch: async () => ({ ok: true, json: async () => [] }),
    fetchWorkPlanRecord: async date => ({ date, revision: '"etag"', data: { date, plans: {}, people: {}, communications: [] } }), ...deps,
  });
  return { context, nodes };
}
test("legacy multi-block plans are editable without losing scoped participants", () => {
  const { context, nodes } = screen();
  context.oldPlan = { source: "message", names: ["パートA"], memo: "", kind: "1", off: false,
    blocks: [{ ...block, companions: ["家族A"] }, { ...block, companions: ["家族B"] }] };
  vm.runInContext(`workerMaster=[{display:"パートA",role:"worker"},{display:"家族A",role:"family"},{display:"家族B",role:"family"}];
    record={data:{plans:{test:oldPlan}}}; editPlan("test");`, context);
  assert.equal(nodes["plan-workers"].textContent, "家族A / 家族B");
  assert.equal(nodes["plan-parts"].textContent, "パートA");
  assert.equal(vm.runInContext("blocks.length", context), 2);
  assert.equal(vm.runInContext('blocks[1].companions[0]', context), "家族B");
});
test("failed writes lock until reload and late loads cannot replace new dates", async () => {
  let writes = 0;
  const { context, nodes } = screen({ writeWorkPlan: async () => { writes++; throw new Error("offline"); } });
  await context.loadDay();
  await context.saveRequest({ plan: {} });
  assert.equal(nodes["plan-inputs"].disabled, true);
  await context.saveRequest({ plan: {} });
  assert.equal(writes, 1);
  await context.loadDay();
  assert.equal(nodes["plan-inputs"].disabled, false);
  let finish;
  context.fetchWorkPlanRecord = date => date === "2026-11-04" ? new Promise(resolve => { finish = resolve; })
    : Promise.resolve({ date, data: { plans: {}, communications: [] }, revision: null });
  const old = context.loadDay();
  nodes["plan-date"].value = "2026-11-05";
  await context.loadDay();
  finish({ date: "2026-11-04", data: { plans: {}, communications: [] }, revision: null });
  await old;
  assert.equal(vm.runInContext("record.date", context), "2026-11-05");
});
test("copied and sent status is displayed with sent deletion disabled and history retained", () => {
  const { context, nodes } = screen();
  context.testPlan = { source: "direct", names: ["家族A"], blocks: [block], off: false,
    last_communication: { status: "sent" }, communication_changed: true };
  vm.runInContext("record={data:{plans:{test:testPlan},communications:[]}}; renderSaved();", context);
  assert.match(nodes["saved-plans"].innerHTML, /送信済み・連絡後に変更あり/);
  assert.match(nodes["saved-plans"].innerHTML, /data-delete="test" disabled/);
  assert.match(nodes["saved-plans"].innerHTML, /data-off="test"/);
  vm.runInContext(`testPlan.last_communication.status="copied";
    record.data.communications=[{plan_id:"test",status:"sent",at:"2026-11-04",
      recipients:["家族A"],plan:testPlan,message:"控え"}]; renderSaved();`, context);
  assert.match(nodes["saved-plans"].innerHTML, /data-delete="test" disabled/);
});
test("worker and task modals retain common UI and task group ordering", () => {
  let html;
  const context = load("common/work-plan-form.js", {
    openModal: content => { html = content; }, closeModal() {}, bindModalCloseEvents() {},
    document: { getElementById: () => ({}), querySelectorAll: () => [] },
  });
  context.openPlanTaskModal({ selected: "耕起", onSelect() {} });
  assert.match(html, /<details open><summary>圃場管理/);
  assert.doesNotMatch(html, /href=/);
});
test("daily editor registered only admin/family and owns shift loading", () => {
  const pages = JSON.parse(read("data/pages.json")).pages;
  assert.deepEqual(pages.find(page => page.id === "daily-plan").roles, ["family", "admin"]);
  assert.match(read("schedule/daily-plan/index.html"), /id="load-shift"/);
  assert.match(read("schedule/daily-plan/index.html"), /id="plan-off"/);
});
test("shift import produces grouped input candidates without modifying saved plans", async () => {
  const { context, nodes } = screen({
    config: { api: "https://example.test" }, ensureToken: async () => "test",
    fetch: async url => ({ ok: true, json: async () => url.includes("/shift/edits")
      ? { overrides: {} } : url.includes("/shift/config")
        ? { staff: [{ name: "候補甲", login: "part-a" }, { name: "候補乙", login: "part-b" }] }
        : { scenarios: [{}], generated_at: "timestamp" } }),
    defaultScenarioIndex: () => 0, toInputTime: value => value,
    applyAdjustments: () => [
      { date: "2026-11-04", person: "候補甲", status: "base", proposed_hours: 6, start: "08:00", proposed_end: "15:00" },
      { date: "2026-11-04", person: "候補乙", status: "base", proposed_hours: 6, start: "08:00", proposed_end: "15:00" },
      { date: "2026-11-04", person: "保留", status: "hold", proposed_hours: 6 },
      { date: "2026-11-04", person: "除外", status: "skip", proposed_hours: 6 },
      { date: "2026-11-04", person: "勤務なし", status: "base", proposed_hours: 0 },
    ],
  });
  vm.runInContext('record={data:{plans:{keep:{names:["家族A"]}}}};', context);
  vm.runInContext(`workerMaster=[{display:"候補甲 太郎",name:"part-a",role:"worker"},
    {display:"候補乙 次郎",name:"part-b",role:"worker"},{display:"候補外 三郎",name:"part-c",role:"worker"}];`, context);
  await context.loadShift();
  assert.match(nodes["shift-candidates"].innerHTML, /候補甲 太郎・候補乙 次郎/);
  assert.doesNotMatch(nodes["shift-candidates"].innerHTML, /保留/);
  assert.deepEqual(Array.from(vm.runInContext("selectableParts()", context), worker => worker.display), ["候補甲 太郎", "候補乙 次郎"]);
  assert.equal(vm.runInContext("record.data.plans.keep.names[0]", context), "家族A");
});
test("single worker modal replaces the selection while existing multi-selection stays unchanged", () => {
  for (const single of [false, true]) {
    const picked = new Set();
    const items = ["A", "B"].map(name => ({ dataset: { worker: name },
      classList: { add() { picked.add(name); }, remove() { picked.delete(name); } } }));
    const nodes = { "apply-worker": {}, "clear-worker": {} };
    let selected;
    const context = load("common/filter/filter-worker.js", { openModal() {}, closeModal() {}, bindModalCloseEvents() {},
      document: { getElementById: id => nodes[id], querySelectorAll: selector =>
        selector.endsWith(".selected") ? items.filter(item => picked.has(item.dataset.worker)) : items } });
    context.openWorkerSelectModal({ workers: items.map(item => ({ display: item.dataset.worker })), selected: [], single,
      onApply: value => { selected = Array.from(value); } });
    items[0].onclick(); items[1].onclick(); nodes["apply-worker"].onclick();
    assert.deepEqual(selected, single ? ["B"] : ["A", "B"]);
  }
});
test("shift workers resolve to canonical full names and never guess ambiguous surnames", () => {
  const { resolveShiftWorker: resolve } = load("schedule/daily-plan/daily-plan.js");
  const workers = [{ name: "part-a", display: "候補 太郎" }, { name: "part-b", display: "候補 次郎" }];
  assert.equal(resolve("候補", [{ name: "候補", login: "part-a" }], workers), "候補 太郎");
  assert.equal(resolve("候補　太郎", [], workers), "候補 太郎");
  assert.throws(() => resolve("候補", [], workers), /一意に特定/);
  assert.throws(() => resolve("未登録", [], workers), /ログイン連携/);
  assert.throws(() => resolve("候補", [{ name: "候補", login: "missing" }], workers), /ログイン連携/);
});
test("work modes require matching participants and shift limits survive input clear and same-day reload", async () => {
  const { context, nodes } = screen();
  context.testName = "パートA";
  vm.runInContext('workerMaster=[{display:testName,role:"worker"},{display:"パートB",role:"worker"}];', context);
  nodes["plan-kind"].value = "mixed";
  vm.runInContext('selectedFamily=["家族A"];selectedParts=[testName]; validateParticipants();', context);
  vm.runInContext('shiftEligible=new Set(["パートB"]);', context);
  assert.throws(() => context.validateParticipants(), /シフトにいない/);
  assert.deepEqual(Array.from(vm.runInContext("selectableParts()", context), worker => worker.display), ["パートB"]);
  context.clearForm();
  assert.deepEqual(Array.from(vm.runInContext("selectableParts()", context), worker => worker.display), ["パートB"]);
  vm.runInContext('loadedDate="2026-11-04";', context);
  await context.loadDay();
  assert.equal(vm.runInContext('shiftEligible.has("パートB")', context), true);
  nodes["plan-date"].value = "2026-11-05";
  await context.loadDay();
  assert.equal(vm.runInContext("shiftEligible", context), null);
  nodes["plan-kind"].value = "single";
  vm.runInContext('selectedParts=["パートA","パートB"];selectedFamily=[];', context);
  assert.throws(() => context.validateParticipants(), /作業形態/);
  nodes["plan-kind"].value = "";
  assert.throws(() => context.validateParticipants(), /作業形態を選択/);
});
