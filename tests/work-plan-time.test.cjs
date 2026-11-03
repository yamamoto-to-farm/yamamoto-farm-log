const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const context = vm.createContext({ structuredClone, window: { addEventListener() {} } });
for (const file of ["common/work-plan-time.js", "schedule/daily-plan/daily-plan.js", "admin/message/message-plan.js"]) {
  const source = readFileSync(join(__dirname, "..", "deploy", ...file.split("/")), "utf8");
  vm.runInContext(source.replace(/^import[\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""), context);
}
const plain = value => JSON.parse(JSON.stringify(value));
const range = (start, end) => ({ start, end });
const attendance = { A: [range("08:00", "15:30")], B: [range("09:00", "16:00")] };
const block = { ...range("13:00", "16:00"), task: "収穫", fields: ["圃場"], shed: false };
const availability = (plans = {}, editingId = "", other = [], shifts = attendance) =>
  context.availableWorkTimes(["A", "B"], shifts, plans, editingId, other, 60);
const timedPlan = () => {
  const participation = context.participationForWork(block, ["A", "B"], availability());
  return { ...context.createUnifiedPlan(["家族"], ["A", "B"], [{ ...block, participation }], "", "", false, "", "direct", attendance),
    updated_at: "revision-1" };
};

test("time candidates exclude noon breaks and retain later departure for each participant", () => {
  assert.deepEqual(plain(availability().candidates), [range("08:00", "12:00"), range("13:00", "16:00")]);
  const parts = plain(context.participationForWork(block, ["A", "B"], availability()));
  assert.deepEqual(parts, { A: [range("13:00", "15:30")], B: [range("13:00", "16:00")] });
  const morning = plain(context.participationForWork(range("08:00", "12:00"), ["A", "B"], availability()));
  assert.equal(morning.B[0].start, "09:00");
  assert.throws(() => context.participationForWork(range("11:00", "14:00"), ["A", "B"], availability()), /昼休憩/);
  assert.throws(() => context.participationForWork(range("15:30", "16:00"), ["A", "B"], availability()), /参加できない/);
});
test("availability excludes individual commitments, ignores editing self and cancelled work, and flags untimed plans", () => {
  const saved = timedPlan();
  const plans = { self: saved, cancelled: { ...saved, off: true }, unknown: { ...saved, blocks: [{ task: "草とり", start: "", end: "" }] } };
  assert.deepEqual(plain(availability(plans, "self").candidates), plain(availability().candidates));
  assert.deepEqual(plain(availability(plans, "self").unknown), ["A", "B"]);
  assert.deepEqual(plain(availability({ existing: saved }).candidates), [range("08:00", "12:00")]);
  assert.deepEqual(plain(availability({}, "", [range("09:30", "10:30")]).candidates),
    [range("08:00", "09:30"), range("10:30", "12:00"), range("13:00", "16:00")]);
});
test("unknown duty or break settings never produce success-shaped time candidates", () => {
  assert.throws(() => availability({}, "", [], { A: [] }), /出退勤時間/);
  assert.throws(() => context.workingTimeRanges(attendance.A, null), /休憩/);
  assert.throws(() => context.mergeTimeRanges([range("25:00", "26:00")]), /形式/);
});
test("split shifts and custom noon break length remain distinct", () => {
  assert.deepEqual(plain(context.workingTimeRanges([range("08:00", "16:00")], 45)),
    [range("08:00", "12:00"), range("12:45", "16:00")]);
  assert.deepEqual(plain(context.workingTimeRanges([range("08:00", "11:00"), range("14:00", "16:00")], 60)),
    [range("08:00", "11:00"), range("14:00", "16:00")]);
});
test("saved attendance and participation produce two messages with exact departure and task times", () => {
  const plan = timedPlan(), groups = context.messageGroups({ harvest: plan });
  assert.equal(groups.length, 2);
  const a = groups.find(group => group.recipients.includes("A"));
  const b = groups.find(group => group.recipients.includes("B"));
  assert.match(context.buildGroupMessage(a, "2026-11-04"), /出勤：08:00　退勤：15:30/);
  assert.match(context.buildGroupMessage(a, "2026-11-04"), /13:00〜15:30/);
  assert.match(context.buildGroupMessage(b, "2026-11-04"), /出勤：09:00　退勤：16:00/);
  assert.match(context.buildGroupMessage(b, "2026-11-04"), /13:00〜16:00/);
  assert.deepEqual(plain(plan.blocks[0].participation), { A: [range("13:00", "15:30")], B: [range("13:00", "16:00")] });
  assert.equal(plan.blocks[0].end, "16:00");
});
test("same assignments and duty combine; differing participation and inconsistent captured duty do not silently combine", () => {
  const plan = timedPlan();
  plan.attendance.B = structuredClone(plan.attendance.A);
  plan.blocks[0].participation.B = structuredClone(plan.blocks[0].participation.A);
  assert.equal(context.messageGroups({ p: plan }).length, 1);
  plan.blocks[0].participation.B[0].start = "14:00";
  assert.equal(context.messageGroups({ p: plan }).length, 2);
  const other = structuredClone(plan);
  other.attendance.A[0].end = "16:00";
  assert.match(context.messageGroups({ p: plan, q: other }).find(group => group.recipients.includes("A")).issues[0], /出退勤時間が異なり/);
});
test("copy controls keep original revisions and snapshots when rendering individual times", async () => {
  const plan = timedPlan(), group = context.messageGroups({ p: plan })[0];
  let request;
  await context.recordGroupCopy("2026-11-04", group, context.buildGroupMessage(group, "2026-11-04"),
    async () => ({ revision: '"etag"', data: { plans: { p: plan } } }), async value => { request = value; return { saved: true, date: value.date }; });
  assert.deepEqual(plain(request.copies), [{ id: "p", plan_revision: "revision-1" }]);
  assert.equal(plan.blocks[0].end, "16:00");
  const changed = structuredClone(plan);
  changed.attendance.A[0].end = "15:00";
  assert.throws(() => context.checkMessageGroup(group, { p: changed }), /変更・削除/);
});
test("legacy plans can be read but require captured duty before copying; cancelled work never instructs attendance", () => {
  const plan = timedPlan();
  delete plan.attendance;
  assert.match(context.communicationIssues(plan)[0], /出退勤時間/);
  plan.off = true;
  const text = context.buildGroupMessage(context.messageGroups({ p: plan })[0], "2026-11-04");
  assert.doesNotMatch(text, /出勤：/);
  assert.match(text, /お休み/);
});
