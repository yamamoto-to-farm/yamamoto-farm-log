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
  vm.runInContext(strip(read("common/work-plan-time.js")), context);
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
test("single free interval initializes once, worker changes never overwrite entered times, and editing retains captured duty", () => {
  const { context, nodes } = screen();
  vm.runInContext(`
    record={time_support:true,data:{plans:{}}}; shiftReady=true; noonBreak=60;
    selectedParts=["パートA"]; shiftGroups=[{names:["パートA"],start:"13:00",end:"16:00"}];
    blocks=[{task:"収穫",start:"",end:"",fields:["圃場"],shed:false}];
    initializeWorkTime();renderBlocks();`, context);
  assert.equal(vm.runInContext("blocks[0].start", context), "13:00");
  assert.match(nodes["plan-blocks"].innerHTML, /data-time-choice="0"/);
  assert.match(nodes["plan-blocks"].innerHTML, /パートA：13:00〜16:00/);
  vm.runInContext('blocks[0].start="14:00";shiftGroups[0].end="15:30";initializeWorkTime();renderBlocks();', context);
  assert.equal(vm.runInContext("blocks[0].start", context), "14:00");
  assert.equal(vm.runInContext("blocks[0].end", context), "16:00");
  assert.match(nodes["plan-blocks"].innerHTML, /勤務時間外/);
  vm.runInContext('blocks[0].start="";blocks[0].end="";shiftGroups[0].start="08:00";initializeWorkTime();', context);
  assert.equal(vm.runInContext("blocks[0].start", context), "");
});
test("family notices are opt-in, timed and retained on editing", () => {
  const { context, nodes } = screen();
  const create = context.createUnifiedPlan;
  const timed = { ...block, start: "08:00", end: "12:00", fields: ["圃場"] };
  const plan = create(["家族A"], [], [timed], "", "", false, "", "direct", null, ["家族A"]);
  assert.deepEqual(Array.from(plan.recipients), ["家族A"]);
  assert.equal(plan.attendance["家族A"][0].start, "08:00");
  assert.equal(plan.blocks[0].participation["家族A"][0].end, "12:00");
  assert.throws(() => create(["家族A"], [], [block], "", "", false, "", "direct", null, ["家族A"]), /開始・終了/);
  assert.throws(() => create(["家族A"], [], [timed], "", "", false, "", "direct", null, ["別人"]), /家族の連絡先/);
  context.testFamilyPlan = plan;
  vm.runInContext(`record={data:{plans:{test:testFamilyPlan}}};
    workerMaster=[{display:"家族A",role:"family"}];cleanSnapshot=snapshot();editPlan("test");`, context);
  assert.match(nodes["family-recipients"].innerHTML, /data-family-recipient="家族A" checked/);
  assert.equal(vm.runInContext('selectedFamilyRecipients[0]', context), "家族A");
  vm.runInContext("selectedFamily=[];renderWorkers();", context);
  assert.equal(vm.runInContext("selectedFamilyRecipients.length", context), 0);
});
test("mixed notices keep part duty and require notified family on every block", () => {
  const { createUnifiedPlan: create } = load("schedule/daily-plan/daily-plan.js");
  const timed = { ...block, start: "08:00", end: "16:00", fields: ["圃場"],
    participation: { "パートA": [{ start: "13:00", end: "16:00" }] } };
  const duty = { "パートA": [{ start: "13:00", end: "16:00" }] };
  const plan = create(["家族A"], ["パートA"], [timed], "", "", false, "", "direct", duty, ["家族A"]);
  assert.deepEqual(Array.from(plan.recipients), ["パートA", "家族A"]);
  assert.equal(plan.attendance["パートA"][0].start, "13:00");
  assert.equal(plan.attendance["家族A"][0].start, "08:00");
  assert.throws(() => create(["家族A"], ["パートA"], [{ ...timed, companions: [] }],
    "", "", false, "", "direct", duty, ["家族A"]), /全作業に参加/);
});
test("cancellation preserves tasks, supports old message edits and separate sources", () => {
  const { createUnifiedPlan: create } = load("schedule/daily-plan/daily-plan.js");
  const cancelled = create(["家族A"], ["パートA"], [block], "", "", true, "雨天", "message");
  assert.equal(cancelled.off, true);
  assert.equal(cancelled.source, "message");
  assert.equal(cancelled.blocks[0].task, "耕起");
  assert.equal(cancelled.message, "");
});
test("mixed editor separates overall family time from part duty and retains it on edit", () => {
  const { context, nodes } = screen();
  vm.runInContext(`
    record={data:{plans:{}}};shiftReady=true;shiftEligible=new Set(["パートA"]);noonBreak=60;
    selectedFamily=["家族A"];selectedParts=["パートA"];
    shiftGroups=[{names:["パートA"],start:"13:00",end:"16:30"}];
    blocks=[{task:"草とり",start:"08:00",end:"16:30",fields:["圃場"],shed:false}];
    initializeWorkTime();renderBlocks();`, context);
  assert.match(nodes["plan-blocks"].innerHTML, /作業全体の開始/);
  assert.match(nodes["plan-blocks"].innerHTML, /家族：家族A 08:00〜16:30/);
  assert.match(nodes["plan-blocks"].innerHTML, /パートA：13:00〜16:30/);
  assert.doesNotMatch(nodes["plan-blocks"].innerHTML, / min=| max=|勤務時間外/);
  vm.runInContext(`
    blocks[0].participation=participationForWork(blocks[0],selectedParts,blockAvailability(0),blockFamily(blocks[0]).length>0);
    record.data.plans.test=createUnifiedPlan(selectedFamily,selectedParts,blocks,"","",false,"","direct",attendanceForSelection());`, context);
  vm.runInContext(`
    cleanSnapshot=snapshot();
    workerMaster=[{display:"家族A",role:"family"},{display:"パートA",role:"worker"}];
    editPlan("test");`, context);
  assert.equal(vm.runInContext('blocks[0].start', context), "08:00");
  assert.equal(vm.runInContext('blocks[0].end', context), "16:30");
  assert.equal(vm.runInContext('blocks[0].participation["パートA"][0].start', context), "13:00");
  assert.doesNotMatch(nodes["plan-blocks"].innerHTML, /勤務時間外/);
  vm.runInContext('blocks[0].companions=[];renderBlocks();', context);
  assert.match(nodes["plan-blocks"].innerHTML, / min="13:00"/);
  assert.match(nodes["plan-blocks"].innerHTML, /勤務時間外/);
});
test("work-time and meeting toggles reflect selection, and cancellation reset stays in sync", () => {
  const { context, nodes } = screen();
  vm.runInContext(`
    record={data:{plans:{}}};shiftReady=true;shiftEligible=new Set(["パートA"]);noonBreak=60;selectedParts=["パートA"];
    shiftGroups=[{names:["パートA"],start:"08:00",end:"15:30"}];
    blocks=[{task:"収穫",start:"08:00",end:"15:30",fields:[],shed:true}];renderBlocks();setPlanOff(true);`, context);
  assert.match(nodes["plan-blocks"].innerHTML, /aria-pressed="true">08:00〜15:30（通し・昼休憩あり）/);
  assert.match(nodes["plan-blocks"].innerHTML, /data-shed="0" aria-pressed="true">作業場集合/);
  assert.doesNotMatch(nodes["plan-blocks"].innerHTML, /type="checkbox"/);
  assert.equal(nodes["plan-off"].checked, true);
  assert.equal(nodes["plan-off-toggle"]["aria-pressed"], "true");
  vm.runInContext("clearForm();", context);
  assert.equal(nodes["plan-off"].checked, false);
  assert.equal(nodes["plan-off-toggle"]["aria-pressed"], "false");
  assert.match(read("schedule/daily-plan/index.html"), /id="plan-off-toggle" type="button"/);
  assert.match(read("schedule/daily-plan/daily-plan.css"), /plan-toggle\[aria-pressed="true"\]/);
});
function screen(deps = {}) {
  const nodes = {};
  const ids = ["plan-date", "plan-inputs", "saved-plans", "message-link", "status", "plan-login", "plan-workers",
    "plan-parts", "participant-kind", "plan-form", "plan-blocks", "editing-label", "plan-memo", "page-area",
    "plan-reporter", "plan-off", "plan-off-toggle", "plan-off-reason", "communication-history", "shift-candidates", "shift-state", "work-plan-link",
    "plan-kind", "plan-scope", "reporter-group", "unplanned-parts", "continue-team",
    "family-recipients", "family-recipients-group"];
  for (const id of ids) nodes[id] = { value: "", checked: false, children: [], innerHTML: "",
    setAttribute(key, value) { this[key] = value; },
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
  assert.equal(nodes["plan-workers"].textContent, "家族A / 家族B / パートA");
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
  assert.match(nodes["saved-plans"].innerHTML, /送信済み（LINE受付・配達未確認）・連絡後に変更あり/);
  assert.match(nodes["saved-plans"].innerHTML, /data-delete="test" disabled/);
  assert.match(nodes["saved-plans"].innerHTML, /data-off="test"/);
  vm.runInContext(`testPlan.last_communication.status="copied";
    record.data.communications=[{plan_id:"test",status:"sent",at:"2026-11-04",
      recipients:["家族A"],plan:testPlan,message:"控え"}]; renderSaved();`, context);
  assert.match(nodes["saved-plans"].innerHTML, /data-delete="test" disabled/);
});
test("family-only cards omit communication prompts while part and legacy message plans retain them", () => {
  const { context, nodes } = screen();
  context.testPlan = { source: "direct", names: ["家族A"], recipients: [], blocks: [block], off: false };
  vm.runInContext("record={data:{plans:{test:testPlan},communications:[]}};renderSaved();", context);
  assert.doesNotMatch(nodes["saved-plans"].innerHTML, /連絡前|連絡文を開く/);
  assert.match(nodes["saved-plans"].innerHTML, /data-edit="test"|data-off="test"|data-delete="test"/);
  vm.runInContext('delete testPlan.recipients;renderSaved();', context);
  assert.doesNotMatch(nodes["saved-plans"].innerHTML, /連絡前|連絡文を開く/);
  vm.runInContext('testPlan.names=["パートA"];testPlan.recipients=["パートA"];renderSaved();', context);
  assert.match(nodes["saved-plans"].innerHTML, /連絡前/);
  assert.match(nodes["saved-plans"].innerHTML, /連絡文を開く/);
  vm.runInContext('testPlan.source="message";delete testPlan.recipients;renderSaved();', context);
  assert.match(nodes["saved-plans"].innerHTML, /連絡前/);
  assert.match(nodes["saved-plans"].innerHTML, /連絡文を開く/);
});
function historyFixture() {
  const plan = { source: "direct", names: ["A"], recipients: ["A"], kind: "1", reporter: "", off: false,
    off_reason: "", memo: "", manual_text: false, message: "", updated_at: "revision-1",
    attendance: { A: [{ start: "08:00", end: "16:30" }] },
    blocks: [{ task: "草とり", fields: ["圃場A"], field: "", start: "08:00", end: "16:30", shed: false,
      companions: ["家族"], participation: { A: [{ start: "08:00", end: "12:00" }, { start: "13:00", end: "16:30" }] } }] };
  const item = { id: "copy", plan_id: "a", status: "copied", at: "2026-11-04T06:43:10.725128+00:00",
    author: "admin", plan_revision: plan.updated_at, recipients: ["A"], plan: structuredClone(plan),
    message: "かっぱを持ってきてください。\n\nよろしくお願いします。" };
  return { plan, item };
}
test("history groups a multi-plan copy once and retains older events per exact recipient set", () => {
  const { communicationHistoryGroups: group } = load("schedule/daily-plan/daily-plan.js");
  const { item } = historyFixture();
  const items = [
    { ...item, at: "2026-11-04T06:00:00Z", recipients: ["B", "A"] },
    { ...item, plan_id: "b", recipients: ["A", "B"] },
    { ...item, recipients: ["B", "A"] },
    { ...item, recipients: ["A"], at: "2026-11-04T06:44:00Z" },
  ];
  const before = JSON.stringify(items);
  const groups = group(items);
  assert.equal(groups.length, 2);
  assert.deepEqual(Array.from(groups[0][0].recipients), ["A"]);
  assert.equal(groups[1].length, 2);
  assert.equal(groups[1][0].items.length, 2);
  assert.equal(groups[1][1].items.length, 1);
  assert.equal(JSON.stringify(items), before);
});
test("history compares meaningful plan contents rather than revision or metadata and object key order", () => {
  const { communicationChanges: changes } = load("schedule/daily-plan/daily-plan.js");
  const { plan, item } = historyFixture();
  const event = { ...item, items: [item] };
  const current = structuredClone(plan);
  current.updated_at = "revision-2";
  current.updated_by = "someone";
  current.last_communication = { status: "copied" };
  current.communication_changed = true;
  current.blocks[0].participation.A = current.blocks[0].participation.A.map(({ start, end }) => ({ end, start }));
  assert.equal(changes(event, { a: current }).length, 0);
  const cases = [
    ["出退勤・作業時間", p => { p.blocks[0].start = "09:00"; }],
    ["出退勤・作業時間", p => { p.attendance.A[0].start = "09:00"; }],
    ["出退勤・作業時間", p => { p.blocks[0].participation.A[0].end = "11:30"; }],
    ["作業内容", p => { p.blocks[0].task = "収穫"; }],
    ["圃場・集合場所", p => { p.blocks[0].fields = ["圃場B"]; }],
    ["圃場・集合場所", p => { p.blocks[0].shed = true; }],
    ["作業者・宛先", p => { p.blocks[0].companions = ["別の家族"]; }],
    ["作業者・宛先", p => { p.recipients = []; }],
    ["作業形態・連絡係", p => { p.kind = "2"; p.reporter = "A"; }],
    ["中止・中止理由", p => { p.off = true; p.off_reason = "雨天"; }],
    ["メモ・予定の補足", p => { p.memo = "注意"; }],
  ];
  for (const [label, change] of cases) {
    const updated = structuredClone(plan);
    change(updated);
    assert.ok(changes(event, { a: updated }).includes(label), label);
  }
});
test("history detects deletion and new assignments for the copied recipients, not unrelated family or other people", () => {
  const { communicationChanges: changes } = load("schedule/daily-plan/daily-plan.js");
  const { plan, item } = historyFixture();
  const event = { ...item, items: [item] };
  assert.deepEqual(Array.from(changes(event, {})), ["予定の削除"]);
  assert.deepEqual(Array.from(changes(event, { a: plan, added: plan })), ["予定の追加"]);
  assert.equal(changes(event, { a: plan, family: { ...plan, recipients: [] },
    other: { ...plan, names: ["B"], recipients: ["B"] } }).length, 0);
  assert.deepEqual(Array.from(changes(event, { a: plan, legacy: { ...plan, source: "message", recipients: undefined } })), ["予定の追加"]);
});
test("history shows latest Japanese time and change warning while messages and older copies start collapsed", () => {
  const { context, nodes } = screen();
  const { plan, item } = historyFixture();
  context.testPlan = { ...plan, blocks: [{ ...plan.blocks[0], fields: ["圃場B"] }] };
  context.testHistory = [item, { ...item, id: "old", at: "2026-11-04T06:42:00Z", message: "<script>old</script>" }];
  vm.runInContext("record={data:{plans:{a:testPlan},communications:testHistory}}; renderSaved();", context);
  const html = nodes["communication-history"].innerHTML;
  assert.equal((html.match(/class="communication-recipient"/g) || []).length, 1);
  assert.match(html, /最新：2026\/11\/04 15:43（日本時間） コピー済み/);
  assert.match(html, /変更あり・再連絡が必要（圃場・集合場所）/);
  assert.match(html, /過去の履歴 1件/);
  assert.match(html, /かっぱを持ってきてください/);
  assert.match(html, /出退勤：08:00〜16:30/);
  assert.match(html, /参加：08:00〜12:00・13:00〜16:30/);
  assert.match(html, /&lt;script&gt;old&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<details[^>]*open|<script>|06:43:10/);
  assert.match(read("schedule/daily-plan/index.html"), /コピー済みはLINE送信完了を意味しません/);
});
test("history combines multiple snapshots with one exact copied message, and displays unchanged or empty states", () => {
  const { context, nodes } = screen();
  const { plan, item } = historyFixture();
  context.testPlan = plan;
  context.testHistory = [item, { ...item, id: "second", plan_id: "b" }];
  vm.runInContext("record={data:{plans:{a:testPlan,b:testPlan},communications:testHistory}};renderSaved();", context);
  const html = nodes["communication-history"].innerHTML;
  assert.equal((html.match(/<pre>/g) || []).length, 1);
  assert.equal((html.match(/class="communication-snapshot"/g) || []).length, 2);
  assert.match(html, /現在の予定から変更なし/);
  assert.doesNotMatch(html, /過去の履歴|再連絡が必要/);
  vm.runInContext("record.data.communications=[]; renderSaved();", context);
  assert.match(nodes["communication-history"].innerHTML, /控えはありません/);
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
        ? { break_minutes: { spanning_noon: 45 }, staff: [{ name: "候補甲", login: "part-a" }, { name: "候補乙", login: "part-b" }] }
        : { scenarios: [{}], targets: { break_minutes: { spanning_noon: 60 } }, generated_at: "timestamp" } }),
    defaultScenarioIndex: () => 0, toInputTime: value => value,
    applyAdjustments: () => [
      { date: "2026-11-04", person: "候補甲", status: "base", proposed_hours: 6, start: "08:00", proposed_end: "15:00" },
      { date: "2026-11-04", person: "候補乙", status: "base", proposed_hours: 6, start: "08:00", proposed_end: "15:00" },
      { date: "2026-11-04", person: "保留", status: "hold", proposed_hours: 6 },
      { date: "2026-11-04", person: "除外", status: "skip", proposed_hours: 6 },
      { date: "2026-11-04", person: "勤務なし", status: "base", proposed_hours: 0 },
    ],
  });
  vm.runInContext('record={data:{plans:{keep:{names:["家族A"],off:false,blocks:[]}}}};', context);
  vm.runInContext(`workerMaster=[{display:"候補甲 太郎",name:"part-a",role:"worker"},
    {display:"候補乙 次郎",name:"part-b",role:"worker"},{display:"候補外 三郎",name:"part-c",role:"worker"}];`, context);
  await context.loadShift();
  assert.deepEqual(Array.from(vm.runInContext("shiftGroups[0].names", context)), ["候補甲 太郎", "候補乙 次郎"]);
  assert.match(nodes["shift-state"].textContent, /2人/);
  assert.equal(vm.runInContext("noonBreak", context), 60);
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
  vm.runInContext('shiftGroups=[{names:["パートB"],start:"08:00",end:"16:00"}];', context);
  await context.loadDay();
  assert.equal(vm.runInContext('shiftEligible.has("パートB")', context), true);
  assert.equal(vm.runInContext("shiftGroups.length", context), 1);
  nodes["plan-date"].value = "2026-11-05";
  await context.loadDay();
  assert.equal(vm.runInContext("shiftEligible", context), null);
  assert.equal(vm.runInContext("shiftGroups.length", context), 0);
  nodes["plan-kind"].value = "single";
  vm.runInContext('selectedParts=["パートA","パートB"];selectedFamily=[];', context);
  assert.throws(() => context.validateParticipants(), /作業形態/);
  nodes["plan-kind"].value = "";
  assert.throws(() => context.validateParticipants(), /作業形態を選択/);
});
test("registration checks only shift parts and ignores times and family omissions", () => {
  const { context, nodes } = screen();
  context.testPlans = {
    morningA: { names: ["パートA", "パートB"], off: false,
      blocks: [{ ...block, task: "草とり", start: "08:00", end: "12:00" }] },
    morningB: { names: ["パートC"], off: false,
      blocks: [{ ...block, task: "潅水", start: "08:00", end: "12:00", companions: ["家族A"] }] },
    afternoon: { names: ["パートA", "パートB", "パートC"], off: false,
      blocks: [{ ...block, task: "収穫", start: "13:00", end: "16:00", companions: ["家族A"] }] },
    optional: { names: ["家族A"], off: false, blocks: [{ ...block, task: "<整備>" }] },
    cancelled: { names: ["パートD"], off: true, blocks: [block] },
  };
  vm.runInContext(`record={data:{plans:testPlans}};
    workerMaster=[{display:"家族A",role:"family"},...["A","B","C","D"].map(id=>({display:"パート"+id,role:"worker"}))];
    shiftEligible=new Set(["パートA","パートB","パートC","パートD"]);shiftReady=true;
    shiftGroups=[{names:["パートA","パートB","パートC","パートD"],start:"08:00",end:"16:00"}];`, context);
  nodes["plan-kind"].value = "mixed";
  context.renderUnplannedParts();
  assert.match(nodes["unplanned-parts"].textContent, /パートDは作業予定がありません/);
  assert.doesNotMatch(nodes["unplanned-parts"].textContent, /家族|パートA|パートB|パートC/);
  const assignments = context.workerAssignments("家族A", context.testPlans);
  assert.deepEqual(Array.from(assignments, item => item.task), ["潅水", "収穫", "<整備>"]);
  assert.equal(context.workerAssignments("パートD", context.testPlans).length, 0);
  vm.runInContext('testPlans.cancelled.off=false;testPlans.cancelled.blocks[0].start="";testPlans.cancelled.blocks[0].end="";', context);
  context.renderUnplannedParts();
  assert.match(nodes["unplanned-parts"].textContent, /登録済み/);
});
test("scope filters work modes and normal mixed plans do not repeat family selection per task", () => {
  const { context, nodes } = screen();
  vm.runInContext('inputScope="parts";renderScope();', context);
  assert.doesNotMatch(nodes["plan-kind"].innerHTML, /①家族のみ/);
  assert.match(nodes["plan-kind"].innerHTML, /②家族＋パート/);
  vm.runInContext('inputScope="family";renderScope();selectedFamily=["家族A"];selectedParts=["パートA"];', context);
  assert.match(nodes["plan-kind"].innerHTML, /①家族のみ/);
  assert.match(nodes["plan-kind"].innerHTML, /②家族＋パート/);
  assert.doesNotMatch(nodes["plan-kind"].innerHTML, /③パート複数|④パート１人/);
  nodes["plan-kind"].value = "mixed";
  context.renderScope();
  assert.equal(nodes["plan-kind"].value, "mixed");
  vm.runInContext('shiftEligible=new Set(["パートA"]);validateParticipants();', context);
  const mixed = vm.runInContext('blocks[0].task="草とり";createUnifiedPlan(selectedFamily,selectedParts,blocks,"")', context);
  assert.equal(mixed.kind, "1");
  assert.deepEqual(Array.from(mixed.recipients), ["パートA"]);
  context.renderBlocks();
  assert.doesNotMatch(nodes["plan-blocks"].innerHTML, /data-companions/);
  vm.runInContext('blocks=[{task:"草とり",fields:[],start:"",end:"",companions:[]}];renderBlocks();', context);
  assert.match(nodes["plan-blocks"].innerHTML, /既存の作業別参加者設定/);
  assert.doesNotMatch(read("schedule/daily-plan/index.html"), /team-roster|select-family|select-parts/);
});
test("shift headcount hides multiple-part mode without dropping participants or restoring it on clear", () => {
  const { context, nodes } = screen();
  vm.runInContext('inputScope="parts";renderWorkers();', context);
  assert.match(nodes["plan-kind"].innerHTML, /③パート複数/);
  nodes["plan-kind"].value = "parts";
  vm.runInContext('shiftReady=true;shiftEligible=new Set(["パートA"]);selectedParts=["パートA"];renderWorkers();', context);
  assert.doesNotMatch(nodes["plan-kind"].innerHTML, /③パート複数/);
  assert.equal(nodes["plan-kind"].value, "single");
  assert.equal(nodes["reporter-group"].hidden, true);
  assert.doesNotMatch(nodes["participant-kind"].textContent, /1人しか/);
  assert.deepEqual(Array.from(vm.runInContext("selectedParts", context)), ["パートA"]);
  vm.runInContext("validateParticipants();clearForm();", context);
  assert.doesNotMatch(nodes["plan-kind"].innerHTML, /③パート複数/);
  vm.runInContext('shiftEligible=new Set(["パートA","パートB"]);renderWorkers();', context);
  assert.match(nodes["plan-kind"].innerHTML, /③パート複数/);
  nodes["plan-kind"].value = "mixed";
  vm.runInContext('shiftEligible=new Set(["パートA"]);renderWorkers();', context);
  assert.equal(nodes["plan-kind"].value, "mixed");
  vm.runInContext('shiftEligible=new Set();renderWorkers();', context);
  assert.doesNotMatch(nodes["plan-kind"].innerHTML, /③パート複数/);
  vm.runInContext('shiftReady=false;shiftEligible=null;renderWorkers();', context);
  assert.match(nodes["plan-kind"].innerHTML, /③パート複数/);
});
