const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const source = readFileSync(join(__dirname, "..", "deploy", "diary", "planned-work.js"), "utf8")
  .replace(/^import.*\r?\n/gm, "").replace(/^export /gm, "");
function load(deps = {}) {
  const context = vm.createContext({ console: { error() {} }, URLSearchParams, ...deps });
  vm.runInContext(readFileSync(join(__dirname, "..", "deploy", "common", "work-plan-time.js"), "utf8").replace(/^export /gm, ""), context);
  vm.runInContext(source, context);
  return context;
}
const block = { task: "草とり", field: "圃場A", start: "08:00", end: "15:30" };
const log = (data = {}, folder = "hand-weeding") => ({
  folder, displayName: "手作業除草", data: { worker: "担当A／担当B", field: "圃場A", ...data },
});
const plan = { off: false, blocks: [block], manual_text: false };

test("planned work uses the same external heading and card styles as work logs", () => {
  const html = readFileSync(join(__dirname, "..", "deploy", "diary", "index.html"), "utf8");
  assert.match(html, /<details id="plannedWorkPanel" class="print-hide" hidden>\s*<summary class="section-title collapse-title diary-log-title">作業予定<\/summary>\s*<div id="plannedWorkBody" class="card diary-log-card"/);
  assert.match(html, /id="workListTitle" class="[^"]*diary-log-title/);
  assert.match(html, /id="workList" class="[^"]*diary-log-card/);
  const css = readFileSync(join(__dirname, "..", "deploy", "diary", "diary.css"), "utf8");
  assert.match(css, /#plannedWorkPanel > summary::before \{ content: "▶ "; \}/);
  assert.match(css, /#plannedWorkPanel\[open\] > summary::before \{ content: "▼ "; \}/);
  assert.match(css, /summary::-webkit-details-marker \{ display: none; \}/);
  assert.match(css, /#plannedWorkBody details\.planned-work-related > summary \{\s*font-size: 0\.85rem;\s*font-weight: normal;/);
});

test("related logs require exact worker tokens, mapped task and specified field, not time", () => {
  const { relatedPlanLogs: match } = load();
  assert.equal(match("担当A", block, [log({ start: "09:00" })]).length, 1);
  assert.equal(match("担当", block, [log()]).length, 0);
  assert.equal(match("担当A", block, [log({ field: "圃場B" })]).length, 0);
  assert.equal(match("担当A", block, [log({}, "weeding")]).length, 0);
  assert.equal(match("担当C", block, [log({ worker: "", worker1: "担当C" })]).length, 1);
  assert.equal(match("担当A", { ...block, field: "" }, [log({ field: "別圃場" })]).length, 1);
  assert.equal(match("担当A", { ...block, task: "道具整備" },
    [log({ workType: "道具整備" }, "other")]).length, 1);
  assert.equal(match("担当A", { ...block, task: "道具" },
    [log({ workType: "道具整備" }, "other")]).length, 0);
});

test("plans present neutral references per person, cancellation and safe escaped content", () => {
  const { plannedWorkHtml: render } = load();
  const html = render({ 担当A: plan, 担当C: plan }, [log()]);
  assert.match(html, /関連する作業ログ：手作業除草/);
  assert.match(html, /該当する作業ログは見つかりません/);
  assert.doesNotMatch(html, /完了|未実施|✅/);
  assert.match(html, /登録元：業務連絡/);
  assert.match(render({ 担当A: { ...plan, source_label: "朝の担当", manual_text: true } }, []), /登録元：朝の担当/);
  assert.match(render({ 担当A: plan }, null), /比較できません/);
  assert.match(render({}, []), /予定は保存されていません/);
  const cancelled = render({ "<script>": { ...plan, off: true, off_reason: "<img>", memo: "<svg>" } }, []);
  assert.match(cancelled, /中止の連絡/);
  assert.doesNotMatch(cancelled, /<script>|<img>|<svg>|関連する/);
});

test("family plans match optional multiple fields and distinguish herbicide from mowing", () => {
  const { relatedPlanLogs: match, plannedWorkHtml: render } = load();
  const herbicide = { task: "除草剤散布", fields: [], start: "", end: "" };
  const spraying = log({ workType: "除草剤散布", field: "圃場B" }, "weeding");
  const mowing = log({ workType: "草刈り", field: "圃場B" }, "weeding");
  assert.equal(match("担当A", herbicide, [spraying, mowing]).length, 1);
  assert.equal(match("担当A", { ...herbicide, fields: ["圃場A", "圃場B"] }, [spraying]).length, 1);
  assert.equal(match("担当A", { ...herbicide, fields: ["圃場C"] }, [spraying]).length, 0);
  const direct = { ...plan, source: "direct", source_label: "直接入力", blocks: [herbicide] };
  const html = render({ 担当A: { ...direct, entries: [plan, direct] } }, [spraying]);
  assert.match(html, /草とり/);
  assert.match(html, /登録元：直接入力/);
  assert.match(html, /除草剤散布/);
  assert.doesNotMatch(html, /<p>〜|undefined/);
});

test("missing logs link to the corresponding existing input page for each known task", () => {
  const { plannedWorkHtml: render } = load();
  const destinations = [
    ["播種", "seed", "播種ログ"], ["定植", "planting", "定植ログ"],
    ["収穫", "harvest", "収穫ログ"], ["耕起", "field/tillage", "土づくり・耕起ログ"],
    ["土づくり・耕起", "field/tillage", "土づくり・耕起ログ"],
    ["中耕", "intertill", "中耕ログ"], ["畝立て", "bedmaking", "畝立てログ"],
    ...["除草・草刈り", "除草", "草刈り"].map(task => [task, "field/weeding", "除草・草刈りログ"]),
    ...["草とり", "手作業除草"].map(task => [task, "hand-weeding", "除草ログ（手作業）"]),
    ["防除", "pesticide", "防除ログ"], ["施肥", "fertilizer", "施肥ログ"],
    ...["潅水", "灌水"].map(task => [task, "watering", "潅水ログ"]),
    ["圃場整備", "field/maintenance", "圃場整備ログ"],
  ];
  for (const [task, folder, label] of destinations) {
    const html = render({ 担当A: { ...plan, blocks: [{ ...block, task }] } }, []);
    assert.ok(html.includes(`<a href="/${folder}/index.html">${label}へ</a>`), task);
    assert.ok(readFileSync(join(__dirname, "..", "deploy", ...folder.split("/"), "index.html"), "utf8"));
  }
  assert.match(render({ 担当A: { ...plan, blocks: [{ ...block, task: " 草とり " }] } }, []),
    /href="\/hand-weeding\/index.html"/);
  for (const task of ["育苗", "道具整備", "<img>", "__proto__", "constructor"]) {
    assert.doesNotMatch(render({ 担当A: { ...plan, blocks: [{ ...block, task }] } }, []), /<a |<img>/);
  }
  assert.doesNotMatch(render({ 担当A: plan }, [log()]), /<a /);
  assert.doesNotMatch(render({ 担当A: plan }, null), /<a /);
  assert.doesNotMatch(render({ 担当A: { ...plan, off: true } }, []), /<a /);
});

test("private API uses token, no-store and validates response; errors never mean no plans", async () => {
  let request;
  const context = load({
    config: { api: "https://example.test" }, ensureToken: async () => "test",
    fetch: async (url, opts) => {
      request = { url, opts };
      return { ok: true, json: async () => ({ date: "2026-11-04", data: { date: "2026-11-04", people: { 担当A: plan } } }) };
    },
  });
  assert.ok((await context.fetchPlannedWork("2026-11-04")).担当A);
  assert.equal(request.opts.headers.Authorization, "Bearer test");
  assert.equal(request.opts.cache, "no-store");
  for (const status of [401, 403, 404, 500]) {
    context.fetch = async () => ({ ok: false, status });
    await assert.rejects(context.fetchPlannedWork("2026-11-04"), new RegExp(String(status)));
  }
  context.fetch = async () => ({ ok: true, json: async () => ({ date: "2026-11-03" }) });
  await assert.rejects(context.fetchPlannedWork("2026-11-04"), /形式が不正/);
  context.ensureToken = async () => null;
  await assert.rejects(context.fetchPlannedWork("2026-11-04"), /ログイン/);
});

test("shared reader rejects malformed communication snapshots and participant metadata", async () => {
  const saved = { ...plan, names: ["担当A"], recipients: ["担当A"],
    last_communication: { status: "copied", at: "2026-11-04T05:00:00+09:00", plan_revision: "v1" } };
  const snapshot = { id: "copy-a", plan_id: "plan-a", status: "copied", at: "2026-11-04T05:00:00+09:00",
    plan_revision: "v1", recipients: ["担当A"], message: "連絡文", plan: structuredClone(saved) };
  const result = { date: "2026-11-04", revision: '"etag"',
    data: { date: "2026-11-04", people: {}, plans: { "plan-a": saved }, communications: [snapshot] } };
  const context = load({ config: { api: "https://example.test" }, ensureToken: async () => "test",
    fetch: async () => ({ ok: true, json: async () => result }) });
  assert.equal((await context.fetchWorkPlanRecord("2026-11-04")).data.communications.length, 1);
  const invalid = [
    value => { value.data.communications = {}; },
    value => { value.data.communications[0].plan = null; },
    value => { value.data.communications[0].recipients = "担当A"; },
    value => { value.data.communications[0].status = "delivered"; },
    value => { value.data.plans["plan-a"].last_communication = { status: "copied" }; },
    value => { value.data.plans["plan-a"].blocks[0].companions = "家族A"; },
  ];
  for (const mutate of invalid) {
    const bad = structuredClone(result);
    mutate(bad);
    context.fetch = async () => ({ ok: true, json: async () => bad });
    await assert.rejects(context.fetchWorkPlanRecord("2026-11-04"), /形式が不正/);
  }
});
test("shared reader validates captured duty and participation while accepting per-person projections", async () => {
  const timed = { ...plan, names: ["担当A", "担当B"], recipients: ["担当A", "担当B"],
    attendance: { 担当A: [{ start: "08:00", end: "15:30" }], 担当B: [{ start: "09:00", end: "16:00" }] },
    blocks: [{ ...block, start: "13:00", end: "16:00", participation: {
      担当A: [{ start: "13:00", end: "15:30" }], 担当B: [{ start: "13:00", end: "16:00" }],
    } }] };
  const result = { date: "2026-11-04", data: { date: "2026-11-04",
    people: { 担当A: { ...timed, blocks: [{ ...timed.blocks[0], end: "15:30" }] } }, plans: { p: timed } } };
  const context = load({ config: { api: "https://example.test" }, ensureToken: async () => "test",
    fetch: async () => ({ ok: true, json: async () => result }) });
  assert.equal((await context.fetchWorkPlanRecord(result.date)).data.people.担当A.blocks[0].end, "15:30");
  for (const mutate of [
    value => { value.attendance = {}; },
    value => { value.attendance.担当A[0].end = "25:00"; },
    value => { delete value.attendance.担当B; },
    value => { delete value.blocks[0].participation.担当B; },
    value => { value.blocks[0].participation.担当A[0].end = "16:00"; },
    value => { delete value.attendance; },
  ]) {
    const bad = structuredClone(result);
    mutate(bad.data.plans.p);
    context.fetch = async () => ({ ok: true, json: async () => bad });
    await assert.rejects(context.fetchWorkPlanRecord(result.date), /形式が不正/);
  }
});

function screen() {
  const body = { textContent: "", innerHTML: "", children: [], replaceChildren() { this.children = []; this.textContent = ""; }, append(node) { this.children.push(node); } };
  const panel = {};
  const context = load({
    window: { currentRole: "admin" }, location: { search: "?date=2026-11-04" },
    document: { getElementById: id => id === "plannedWorkPanel" ? panel : body, createElement: () => ({}) },
    hasSession: () => true,
  });
  return { context, body, panel };
}
test("diary uses original plan blocks rather than duplicating personal lunch projections", async () => {
  const { context, body } = screen();
  const work = { task: "草とり", start: "08:00", end: "15:30", fields: ["圃場A"], companions: ["家族A"],
    participation: { 担当A: [{ start: "08:00", end: "12:00" }, { start: "13:00", end: "15:30" }] } };
  const saved = { source: "direct", names: ["担当A"], recipients: ["担当A"], blocks: [work], off: false };
  context.fetchWorkPlanRecord = async () => ({ data: {
    people: { 担当A: { ...saved, blocks: [{ ...work, end: "12:00" }, { ...work, start: "13:00" }] },
      家族A: saved }, plans: { test: saved },
  } });
  await context.renderPlannedWork("2026-11-04", Promise.resolve([]));
  assert.equal((body.innerHTML.match(/<article/g) || []).length, 1);
  assert.equal((body.innerHTML.match(/class="planned-work-block"/g) || []).length, 1);
  assert.match(body.innerHTML, /<h3>担当A・家族A<\/h3>/);
  assert.match(body.innerHTML, /08:00〜15:30　草とり/);
  assert.equal((body.innerHTML.match(/href="\/hand-weeding\/index.html"/g) || []).length, 1);
  assert.match(body.innerHTML, /<details class="planned-work-related"><summary>各人の参加時間/);
  assert.match(body.innerHTML, /08:00〜12:00・13:00〜15:30/);
});
test("grouped plans retain scoped companions, exact worker matching, partial missing logs, and distinct IDs", () => {
  const { plannedWorkHtml: render } = load();
  const saved = { source: "direct", names: ["担当A"], off: false,
    blocks: [{ ...block, companions: ["家族A"] }, { ...block, task: "潅水", companions: ["家族B"] }] };
  const joint = log({ worker: "担当A／家族A" });
  const html = render({}, [joint], { one: saved });
  assert.match(html, /<h3>担当A・家族A・家族B/);
  assert.match(html, /作業者：担当A・家族A/);
  assert.match(html, /（1件）/);
  assert.doesNotMatch(html, /（2件）|家族Aの該当ログ/);
  const partial = render({}, [log({ worker: "担当A" })], { one: saved });
  assert.match(partial, /家族Aの該当ログは見つかりません/);
  assert.doesNotMatch(partial, /href="\/hand-weeding/);
  const unrelated = render({}, [log({ worker: "家族B" })], { one: saved });
  assert.match(unrelated, /href="\/hand-weeding/);
  assert.equal((render({}, [], { one: saved, two: saved }).match(/<article/g) || []).length, 2);
  assert.match(render({}, null, { one: saved }), /比較できません/);
  assert.doesNotMatch(render({}, null, { one: saved }), /<a /);
  const cancelled = render({}, [], { one: { ...saved, names: ["<img>"], off: true, off_reason: "<svg>", memo: "<script>" } });
  assert.match(cancelled, /中止の連絡/);
  assert.doesNotMatch(cancelled, /<img>|<svg>|<script>|関連する/);
});
test("plan errors are retryable independently and late responses cannot replace another date", async () => {
  const { context, body, panel } = screen();
  context.fetchWorkPlanRecord = async () => { throw new Error("offline"); };
  await context.renderPlannedWork("2026-11-04", Promise.resolve([]));
  assert.equal(body.textContent, "offline");
  assert.equal(body.children[0].textContent, "再試行");
  context.fetchWorkPlanRecord = async () => ({ data: { people: { 担当A: plan } } });
  await body.children[0].onclick();
  assert.match(body.innerHTML, /担当A/);
  let finish;
  context.fetchWorkPlanRecord = date => date === "2026-11-03" ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ data: { people: {} } });
  const old = context.renderPlannedWork("2026-11-03", Promise.resolve([]));
  await context.renderPlannedWork("2026-11-04", Promise.resolve([]));
  finish({ data: { people: { 担当A: plan } } });
  await old;
  assert.match(body.innerHTML, /予定は保存されていません/);
  assert.equal(panel.open, true);
});
test("workers cannot load private plans and missing login offers explicit login", async () => {
  const { context, body, panel } = screen();
  context.window.currentRole = "worker";
  context.fetchWorkPlanRecord = async () => { throw new Error("must not request"); };
  await context.renderPlannedWork("2026-11-04", Promise.resolve([]));
  assert.equal(panel.hidden, true);
  context.window.currentRole = "family";
  context.hasSession = () => false;
  await context.renderPlannedWork("2026-11-04", Promise.resolve([]));
  assert.equal(panel.hidden, false);
  assert.match(body.textContent, /ログイン/);
  assert.equal(body.children[0].textContent, "ログイン");
});
