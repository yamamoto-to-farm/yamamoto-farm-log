const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const source = readFileSync(join(__dirname, "..", "deploy", "admin", "message", "line.js"), "utf8")
  .replace(/^import[\s\S]*?;\r?\n/gm, "").replace(/^export /gm, "");
const clone = value => JSON.parse(JSON.stringify(value));
const date = "2026-11-05";
const names = ["Part A", "Part B"];
const job = {
  id: "job", date, names, message: "Bring rain gear\nThank you.",
  targets: [{ id: "p1", plan_revision: "v1" }], created_at: "2026-11-04",
  closed: false, recorded: false,
  results: { "Part A": { status: "ready" }, "Part B": { status: "ready" } },
};
const initial = {
  members: names.map((name, i) => ({ name, worker: String(i), linked: true, display_name: name })),
  jobs: [],
};
function harness() {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      hidden: false, disabled: false, textContent: "", innerHTML: "",
      classList: { toggle() {} }, querySelectorAll: () => [], addEventListener() {},
      focus() {}, select() {}, showModal() { this.open = true; }, close() { this.open = false; },
    });
    return elements.get(id);
  };
  const calls = [];
  let state = clone(initial);
  let activeDate = date;
  const options = {
    date: () => activeDate, groups: () => [], message: () => job.message,
    check: async () => calls.push("check"),
    lock: value => calls.push(["lock", value]),
    reload: async () => calls.push("reload"),
  };
  const context = vm.createContext({
    console: { error() {} }, URLSearchParams, config: { api: "https://example.test" },
    ensureToken: async () => "test-token",
    document: { getElementById: element },
    window: { confirm: () => true },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => clone(state) };
    },
  });
  vm.runInContext(source, context);
  context.initLineMessaging(options);
  return { context, calls, element, options,
    setState(value) { state = value; }, setDate(value) { activeDate = value; } };
}
test("authenticated API uses no-store, server errors remain errors", async () => {
  const h = harness();
  await h.context.lineApi(null, null, date);
  const { url, options } = h.calls[0];
  assert.equal(url, `https://example.test/line/manage?date=${date}`);
  assert.equal(options.cache, "no-store");
  assert.equal(options.headers.Authorization, "Bearer test-token");
  h.context.fetch = async () => ({ ok: false, json: async () => ({ message: "Denied" }) });
  await assert.rejects(h.context.lineApi("issue", { worker: "a" }), /Denied/);
  h.context.ensureToken = async () => null;
  await assert.rejects(h.context.lineApi("issue", {}), /ログイン/);
});
test("state response validates individual result statuses", () => {
  const h = harness();
  assert.equal(h.context.validLineState({ ...initial, jobs: [job] }), true);
  assert.equal(h.context.validLineState({ members: [], jobs: [{}] }), false);
  assert.equal(h.context.validLineState({ ...initial, jobs: [{ ...job, results: {} }] }), false);
  assert.equal(h.context.validLineState({ ...initial, members: [{ name: "x", worker: "x" }] }), false);
});
test("prepare checks saved plans and preserves exact edited text before confirmation", async () => {
  const h = harness();
  h.context.testApi = async (action, req) => {
    if (!action) return clone(initial);
    h.calls.push([action, clone(req)]);
    return clone(job);
  };
  vm.runInContext("lineApi=testApi", h.context);
  await h.context.refresh();
  const group = { recipients: names, entries: [{ id: "p1", plan: { updated_at: "v1" } }] };
  await h.context.prepare(group);
  const prepare = h.calls.find(item => Array.isArray(item) && item[0] === "prepare");
  assert.equal(prepare[1].message, job.message);
  assert.deepEqual(prepare[1].targets, job.targets);
  assert.equal(h.element("line-confirm-text").textContent, job.message);
  assert.equal(h.element("line-confirm").open, true);
  assert.ok(h.calls.includes("check"));
  h.setDate("2026-11-06");
  await assert.rejects(h.context.prepare(group), /再取得/);
});
test("delivery is per recipient and preserves durable job ID and exact name", async () => {
  const h = harness();
  const saved = clone(job);
  h.context.testApi = async (action, req) => {
    if (!action) return { ...clone(initial), jobs: [clone(saved)] };
    h.calls.push([action, clone(req)]);
    saved.results[req.name].status = "accepted";
    saved.recorded = saved.names.every(name => saved.results[name].status === "accepted");
    return clone(saved);
  };
  vm.runInContext("lineApi=testApi", h.context);
  h.context.showConfirmation(clone(job));
  await h.context.deliver();
  const sends = h.calls.filter(item => Array.isArray(item) && item[0] === "send");
  assert.deepEqual(sends.map(([, req]) => req), names.map(name => ({
    date, job_id: job.id, name,
  })));
  assert.equal(h.element("line-confirm").open, false);
  assert.match(h.element("line-status").textContent, /控え保存が完了/);
  assert.deepEqual(h.calls.filter(item => Array.isArray(item) && item[0] === "lock"), [
    ["lock", true], ["lock", false],
  ]);
});
test("date changed while checking plans cannot prepare a delivery for a different date", async () => {
  const h = harness();
  await h.context.refresh();
  let release;
  let started;
  const checking = new Promise(done => { started = done; });
  h.options.check = () => new Promise(done => { release = done; started(); });
  const pending = h.context.prepare({ recipients: names, entries: [] });
  await checking;
  h.setDate("2026-11-06");
  release();
  await assert.rejects(pending, /日付が変わりました/);
  assert.equal(h.calls.filter(item => item.options?.method === "POST").length, 0);
});
test("network failure leaves confirmation and reports unknown outcome, no new preparation", async () => {
  const h = harness();
  h.context.testApi = async (action, req) => {
    h.calls.push([action, req]);
    throw new Error("offline");
  };
  vm.runInContext("lineApi=testApi", h.context);
  h.context.showConfirmation(clone(job));
  await h.context.deliver();
  assert.match(h.element("line-confirm-error").textContent, /新しい送信を作らず/);
  assert.equal(h.element("line-confirm").open, true);
  assert.equal(h.element("line-confirm-send").disabled, false);
  assert.equal(h.calls.filter(item => Array.isArray(item) && item[0] === "send").length, 1);
});
test("accepted recipients are not resent and missing history is recovered", async () => {
  const h = harness();
  const completed = clone(job);
  for (const result of Object.values(completed.results)) result.status = "accepted";
  completed.recorded = false;
  h.context.testApi = async (action, req) => {
    if (!action) return { ...clone(initial), jobs: [{ ...completed, recorded: true }] };
    h.calls.push([action, clone(req)]);
    return { ...clone(completed), recorded: true };
  };
  vm.runInContext("lineApi=testApi", h.context);
  h.context.showConfirmation(completed);
  await h.context.deliver();
  assert.equal(h.calls.filter(item => Array.isArray(item) && item[0] === "send").length, 1);
});
test("partial failure is visible and not success shaped", async () => {
  const h = harness();
  const partial = clone(job);
  partial.results[names[0]].status = "accepted";
  partial.results[names[1]] = { status: "failed", error: "Quota" };
  h.context.testApi = async () => clone(partial);
  let calls = 0;
  h.context.testApi = async action => {
    if (!action) return { ...clone(initial), jobs: [partial] };
    calls++;
    return clone(partial);
  };
  vm.runInContext("lineApi=testApi", h.context);
  h.context.showConfirmation(clone(job));
  await h.context.deliver();
  assert.equal(calls, 2);
  assert.match(h.element("line-status").textContent, /未完了の宛先/);
  assert.match(h.element("line-jobs").innerHTML, /失敗|Quota/);
});
test("stale refresh cannot enable send for another selected date", async () => {
  const h = harness();
  let resolve;
  let started;
  const fetching = new Promise(done => { started = done; });
  h.context.fetch = () => new Promise(done => { resolve = done; started(); });
  const pending = h.context.refresh();
  await fetching;
  h.setDate("2026-11-06");
  resolve({ ok: true, json: async () => clone(initial) });
  await pending;
  assert.equal(vm.runInContext("state", h.context), undefined);
});
test("HTML contains dedicated dialog, private code field and keeps copy workflow", () => {
  const html = readFileSync(join(__dirname, "..", "deploy", "admin", "message", "index.html"), "utf8");
  assert.match(html, /<dialog id="line-confirm"/);
  assert.match(html, /id="line-code-text"[^>]*readonly/);
  assert.match(html, /id="line-refresh"/);
  assert.match(html, /コピーはLINE送信を意味しません/);
});
test("issue shows full code only after success, approve pins the pending ID and requires confirmation", async () => {
  const h = harness();
  const pending = { id: "pending-1", display_name: "<unsafe>" };
  h.setState({ ...clone(initial), members: [
    { worker: "a", name: "Part A", linked: false, pending },
  ] });
  await h.context.refresh();
  assert.match(h.element("line-members").innerHTML, /&lt;unsafe&gt;/);
  h.context.testApi = async (action, req) => {
    if (!action) return clone(initial);
    h.calls.push([action, clone(req)]);
    return action === "issue" ? { registration_message: "LINK test-code" } : { saved: true };
  };
  vm.runInContext("lineApi=testApi", h.context);
  await h.context.memberAction({ dataset: { lineApprove: "a" } });
  assert.deepEqual(h.calls.find(item => Array.isArray(item) && item[0] === "approve")[1], {
    worker: "a", pending_id: "pending-1", confirm: true,
  });
  await h.context.memberAction({ dataset: { lineIssue: "0" } });
  assert.equal(h.element("line-code-text").value, "LINK test-code");
  assert.equal(h.element("line-code").hidden, false);
});
