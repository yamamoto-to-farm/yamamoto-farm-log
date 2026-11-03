const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const source = readFileSync(join(__dirname, "..", "deploy", "diary", "planned-work.js"), "utf8")
  .replace(/^import.*\r?\n/gm, "").replace(/^export /gm, "");
function load(deps = {}) {
  const context = vm.createContext({ console: { error() {} }, URLSearchParams, ...deps });
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
test("plan errors are retryable independently and late responses cannot replace another date", async () => {
  const { context, body, panel } = screen();
  context.fetchPlannedWork = async () => { throw new Error("offline"); };
  await context.renderPlannedWork("2026-11-04", Promise.resolve([]));
  assert.equal(body.textContent, "offline");
  assert.equal(body.children[0].textContent, "再試行");
  context.fetchPlannedWork = async () => ({ 担当A: plan });
  await body.children[0].onclick();
  assert.match(body.innerHTML, /担当A/);
  let finish;
  context.fetchPlannedWork = date => date === "2026-11-03" ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({});
  const old = context.renderPlannedWork("2026-11-03", Promise.resolve([]));
  await context.renderPlannedWork("2026-11-04", Promise.resolve([]));
  finish({ 担当A: plan });
  await old;
  assert.match(body.innerHTML, /予定は保存されていません/);
  assert.equal(panel.open, true);
});
test("workers cannot load private plans and missing login offers explicit login", async () => {
  const { context, body, panel } = screen();
  context.window.currentRole = "worker";
  context.fetchPlannedWork = async () => { throw new Error("must not request"); };
  await context.renderPlannedWork("2026-11-04", Promise.resolve([]));
  assert.equal(panel.hidden, true);
  context.window.currentRole = "family";
  context.hasSession = () => false;
  await context.renderPlannedWork("2026-11-04", Promise.resolve([]));
  assert.equal(panel.hidden, false);
  assert.match(body.textContent, /ログイン/);
  assert.equal(body.children[0].textContent, "ログイン");
});
