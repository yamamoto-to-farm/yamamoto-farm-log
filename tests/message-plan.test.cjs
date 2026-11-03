const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const read = file => readFileSync(join(__dirname, "..", "deploy", "admin", "message", file), "utf8");
const strip = source => source.replace(/^import[\s\S]*?;\r?\n/gm, "").replace(/^export /gm, "");
function load(file, deps = {}) {
  const context = vm.createContext({ console: { error() {}, warn() {} }, structuredClone,
    window: { addEventListener() {} }, URLSearchParams, ...deps });
  vm.runInContext(strip(readFileSync(join(__dirname, "..", "deploy", "common", "work-plan-time.js"), "utf8")), context);
  vm.runInContext(strip(read(file)), context);
  return context;
}
const plan = { source: "direct", names: ["パートA"], recipients: ["パートA"], kind: "1",
  attendance: { パートA: [{ start: "08:00", end: "16:00" }] },
  reporter: "", off: false, updated_at: "revision-1", memo: "",
  blocks: [{ task: "草とり", fields: ["圃場A"], start: "08:00", end: "12:00", companions: ["家族A"] }] };
test("messages come from saved plans without including family names or implying delivery", () => {
  const context = load("message-plan.js");
  const message = context.buildPlanMessage(plan, "2026-11-04");
  assert.match(message, /草とり|圃場A|8:00〜12:00/);
  assert.doesNotMatch(message, /家族A/);
  assert.equal(context.communicationIssues(plan).length, 0);
  assert.match(context.buildPlanMessage({ ...plan, off: true, off_reason: "雨天のため" }, "2026-11-04"), /お休み/);
  assert.doesNotMatch(context.buildPlanMessage({ ...plan, off: true }, "2026-11-04"), /草とり/);
  assert.match(context.buildPlanMessage({ ...plan, kind: "2", reporter: "パートA" }, "2026-11-04"), /連絡係はパートA/);
  assert.match(context.buildPlanMessage({ ...plan, kind: "3" }, "2026-11-04"), /1人での作業/);
});
test("communication requires recipients, paired time and field or meeting point", () => {
  const { communicationIssues: issues } = load("message-plan.js");
  assert.ok(issues({ ...plan, recipients: [] }).length);
  assert.ok(issues({ ...plan, blocks: [{ ...plan.blocks[0], start: "" }] }).length);
  assert.ok(issues({ ...plan, blocks: [{ ...plan.blocks[0], fields: [] }] }).length);
  assert.equal(issues({ ...plan, blocks: [{ ...plan.blocks[0], fields: [], shed: true }] }).length, 0);
  assert.equal(issues({ ...plan, off: true, blocks: [] }).length, 0);
  assert.ok(issues({ ...plan, kind: "2", reporter: "" }).length);
  assert.equal(issues({ ...plan, source: "message", recipients: undefined }).length, 0);
});
test("copy controls record a snapshot only, never rewrite the plan or claim sent", async () => {
  const { recordGroupCopy, messageGroups } = load("message-plan.js");
  const group = messageGroups({ test: plan })[0];
  let request;
  await recordGroupCopy("2026-11-04", group, "連絡文", async () =>
    ({ revision: '"etag"', data: { plans: { test: plan } } }), async req => {
    request = req;
    return { saved: true, date: req.date };
  });
  assert.equal(request.operation, "communicate");
  assert.equal(request.copies[0].plan_revision, "revision-1");
  assert.equal(request.message, "連絡文");
  assert.equal(request.plan, undefined);
  assert.equal(request.status, undefined);
  await assert.rejects(recordGroupCopy("2026-11-04", group, "連絡文",
    async () => ({ revision: '"etag"', data: { plans: { test: { ...plan, updated_at: "revision-2" } } } }), async () => assert.fail("write stale")), /変更/);
});
function copyScreen({ failCopy = false, failRecord = false } = {}) {
  const helper = load("message-plan.js");
  const elements = {};
  for (const id of ["cards", "msg-date", "direct-plan-link", "msg-login", "tab-daily", "status"]) {
    elements[id] = { value: "2026-11-04", textContent: "", replaceChildren() {}, classList: { toggle() {} } };
  }
  const notice = {};
  const button = { parentElement: { querySelector: () => notice } };
  const events = [];
  const context = load("message.js", {
    hasSession: () => true, document: { getElementById: id => elements[id] },
    ...helper, window: { addEventListener() {} },
    fetchWorkPlanRecord: async () => ({ date: "2026-11-04", revision: '"etag"', data: { plans: { test: plan }, communications: [] } }),
    writeWorkPlan: async req => { events.push("record"); if (failRecord) throw new Error("offline"); return { saved: true, date: req.date }; },
  });
  context.testPlan = plan;
  context.testCopy = async () => { events.push("copy"); if (failCopy) throw new Error("copy failed"); };
  vm.runInContext('record={data:{plans:{test:testPlan}}}; loadedDate="2026-11-04"; copyText=testCopy;', context);
  return { context, button, notice, events, elements };
}
test("clipboard failure never records a copy, record failure reports copied but unsaved", async () => {
  const failedCopy = copyScreen({ failCopy: true });
  await failedCopy.context.copySavedPlan("test", failedCopy.button);
  assert.deepEqual(failedCopy.events, ["copy"]);
  const failedRecord = copyScreen({ failRecord: true });
  await failedRecord.context.copySavedPlan("test", failedRecord.button);
  assert.deepEqual(failedRecord.events, ["copy", "record"]);
  assert.match(failedRecord.notice.textContent, /コピー済みですが、控えを保存できません/);
});
test("copy success records once and reports no LINE delivery", async () => {
  const { context, button, elements, events } = copyScreen();
  await context.copySavedPlan("test", button);
  assert.deepEqual(events, ["copy", "record"]);
  assert.match(elements.status.textContent, /LINE送信はしていません/);
  assert.equal(elements["tab-daily"].inert, false);
});
test("copy refresh retains this and other pending message drafts", async () => {
  const { context, button, elements } = copyScreen();
  vm.runInContext('drafts.set("test","文面の補足"); drafts.set("other","別の下書き");', context);
  await context.copySavedPlan("test", button);
  assert.match(elements.cards.innerHTML, /文面の補足/);
  assert.equal(vm.runInContext('drafts.get("other")', context), "別の下書き");
});
test("a stale loaded plan cannot be copied and pending duplicate clicks do not copy twice", async () => {
  const stale = copyScreen();
  stale.context.fetchWorkPlanRecord = async () => ({ data: { plans: { test: { ...plan, updated_at: "revision-2" } } } });
  await stale.context.copySavedPlan("test", stale.button);
  assert.equal(stale.events.length, 0);
  assert.match(stale.notice.textContent, /変更・削除/);
  const pending = copyScreen();
  let finish;
  pending.context.testSlowCopy = () => new Promise(resolve => { finish = resolve; });
  vm.runInContext("copyText=testSlowCopy;", pending.context);
  const first = pending.context.copySavedPlan("test", pending.button);
  await new Promise(resolve => setImmediate(resolve));
  await pending.context.copySavedPlan("test", pending.button);
  finish();
  await first;
  assert.deepEqual(pending.events, ["record"]);
});
test("clipboard fallback checks success and always removes the temporary field", async () => {
  let removed = false;
  const context = load("message.js", {
    navigator: { clipboard: { writeText: async () => { throw new Error("denied"); } } },
    document: { body: { appendChild() {} }, createElement: () => ({ select() {}, remove() { removed = true; } }), execCommand: () => false },
  });
  await assert.rejects(context.copyText("文面"), /コピーできません/);
  assert.equal(removed, true);
});
test("message UI has saved-plan loading only and preserves monthly template editing", () => {
  const html = read("index.html");
  assert.match(html, /id="load-plans"/);
  assert.doesNotMatch(html, /id="(?:add-person|load-shift|refresh-shift|apply-memo)"/);
  assert.match(html, /id="template-edit"/);
  assert.match(html, /コピーでは予定を変更せず/);
  const source = read("message.js");
  assert.doesNotMatch(source, /persistMessagePlan|createMessagePlan|loadFromShift/);
});
test("daily messages group identical assignment sets, splitting morning work and merging afternoon content", async () => {
  const helper = load("message-plan.js");
  const plans = {
    a: { ...plan, recipients: ["A"], names: ["A"], blocks: [{ ...plan.blocks[0], task: "草とり", start: "08:00", end: "12:00" }] },
    bc: { ...plan, recipients: ["B", "C"], names: ["B", "C"], blocks: [{ ...plan.blocks[0], task: "潅水", start: "08:00", end: "12:00" }] },
    all: { ...plan, recipients: ["A", "B", "C"], names: ["A", "B", "C"], blocks: [{ ...plan.blocks[0], task: "収穫", start: "13:00", end: "16:00" }] },
  };
  const groups = helper.messageGroups(plans);
  assert.equal(groups.length, 2);
  const first = groups.find(group => group.recipients.includes("A"));
  const second = groups.find(group => group.recipients.includes("B"));
  assert.deepEqual(Array.from(first.recipients), ["A"]);
  assert.deepEqual(Array.from(second.recipients), ["B", "C"]);
  const text = helper.buildGroupMessage(first, "2026-11-04");
  assert.match(text, /草とり/); assert.match(text, /収穫/); assert.doesNotMatch(text, /潅水/);
  assert.equal(text.match(/お疲れさまです/g).length, 1);
  assert.equal(text.match(/よろしくお願いします/g).length, 1);
  assert.match(helper.buildGroupMessage(second, "2026-11-04"), /潅水/);
  let request;
  await helper.recordGroupCopy("2026-11-04", first, text,
    async () => ({ revision: '"etag"', data: { plans } }), async req => { request = req; return { saved: true, date: req.date }; });
  assert.deepEqual(Array.from(request.copies, item => item.id), ["a", "all"]);
  assert.deepEqual(Array.from(request.recipients), ["A"]);
  assert.throws(() => helper.checkMessageGroup(first, { ...plans, extra: plans.a }), /変更・削除/);
  assert.equal(helper.messageGroups({ all: plans.all }).length, 1);
  const cancelled = helper.messageGroups({ a: { ...plans.a, off: true, off_reason: "雨天" }, all: plans.all })[0];
  const cancelledText = helper.buildGroupMessage(cancelled, "2026-11-04");
  assert.match(cancelledText, /中止：08:00〜12:00 草とり/);
  assert.match(cancelledText, /収穫/);
  assert.doesNotMatch(cancelledText, /お休み/);
});
test("combined communication status belongs to its exact recipients and all included plans", () => {
  const helper = load("message-plan.js");
  const group = helper.messageGroups({
    a: { ...plan, names: ["A"], recipients: ["A"] },
    all: { ...plan, names: ["A", "B"], recipients: ["A", "B"] },
  }).find(group => group.recipients.includes("A"));
  const items = group.entries.map(({ id, plan }) => ({
    plan_id: id, plan_revision: plan.updated_at, recipients: ["A"], at: "same", status: "copied",
  }));
  assert.equal(helper.groupCommunicationState(group, items).changed, false);
  assert.equal(helper.groupCommunicationState(group, items.slice(1)), null);
  assert.equal(helper.groupCommunicationState(group, items.map(item => ({ ...item, recipients: ["B"] }))), null);
  group.entries[0].plan = { ...plan, updated_at: "new" };
  assert.equal(helper.groupCommunicationState(group, items).changed, true);
});
