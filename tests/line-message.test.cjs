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
    if (!elements.has(id)) {
      const classes = new Set();
      const listeners = new Map();
      elements.set(id, {
        hidden: false, disabled: false, textContent: "", innerHTML: "",
        insertAdjacentHTML(where, html) { assert.equal(where, "beforeend"); this.innerHTML += html; },
        classList: { toggle(name, on) { if (on) classes.add(name); else classes.delete(name); }, contains: name => classes.has(name) },
        querySelectorAll: () => [], addEventListener(type, handler) { listeners.set(type, handler); },
        focus() { this.focused = true; }, select() {}, showModal() { this.open = true; },
        close() { this.open = false; listeners.get("close")?.(); },
      });
    }
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
test("daily and template history share receipt counts and a separate, safely escaped body", async () => {
  const h = harness();
  const daily = { ...clone(job), ack_enabled: true, created_at: "2026-11-04T00:00:00Z",
    message: "\nTest <body>", results: {
      "Part A": { status: "accepted", confirmed_at: "2026-11-05T00:00:00Z", first_attempt: 1793836800 },
      "Part B": { status: "failed" },
    } };
  const template = { ...daily, id: "template", kind: "template", title: "Reminder", history_at: 1793836800 };
  h.setState({ ...initial, jobs: [daily, template] });
  await h.context.refresh();
  const dailyMarkup = h.element("line-jobs").innerHTML;
  assert.match(dailyMarkup, /class="line-job" open>\s*<summary><span>2026\/11\/5 0?9:00:00｜Part A・Part B<\/span>/);
  assert.doesNotMatch(dailyMarkup, /Reminder/);
  h.context.testApi = async () => ({ jobs: [template], next_cursor: null });
  vm.runInContext("lineApi=testApi", h.context);
  await h.context.loadTemplateHistory();
  const templateMarkup = h.element("template-line-jobs").innerHTML;
  assert.match(templateMarkup, /class="line-job">\s*<summary><span>2026\/11\/5 0?9:00:00｜Reminder<\/span>/);
  for (const html of [dailyMarkup, templateMarkup]) {
    assert.match(html, /line-job-meta[^>]*>宛先 2名 · LINE受付 1\/2名 · 本人確認 1\/2名[\s\S]*送信失敗 1名/);
    assert.match(html, /送信記録の日付：2026-11-05[\s\S]*本人確認済み[\s\S]*<figure class="line-job-body">\s*<figcaption>本文<\/figcaption>\s*<pre class="line-preview">\n\nTest &lt;body&gt;<\/pre>/);
  }
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
test("automatic refresh displays success and last update and clears stale history while loading", async () => {
  const h = harness();
  await h.context.refreshLineState();
  assert.match(h.element("line-status").textContent, /取得しました/);
  assert.match(h.element("line-updated").textContent, /2026-11-05/);
  assert.match(h.element("line-members").innerHTML, /Part A/);
  let finish;
  h.context.fetch = () => new Promise(resolve => { finish = resolve; });
  h.setDate("2026-11-06");
  const pending = h.context.refreshLineState();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.element("line-members").innerHTML, "");
  assert.equal(h.element("line-jobs").innerHTML, "");
  assert.equal(h.element("line-updated").textContent, "");
  assert.match(h.element("line-status").textContent, /取得中/);
  finish({ ok: true, json: async () => clone(initial) });
  await pending;
  assert.match(h.element("line-updated").textContent, /2026-11-06/);
});
test("automatic refresh reports failure and a manual retry recovers", async () => {
  const h = harness();
  h.context.fetch = async () => { throw new Error("offline"); };
  await h.context.refreshLineState();
  assert.match(h.element("line-status").textContent, /offline.*再取得.*コピー/);
  assert.equal(h.element("line-connection").classList.contains("line-fetch-failed"), true);
  assert.equal(vm.runInContext("state", h.context), undefined);
  assert.equal(h.element("line-updated").textContent, "");
  h.context.fetch = async () => ({ ok: true, json: async () => clone(initial) });
  await h.element("line-refresh").onclick();
  assert.match(h.element("line-status").textContent, /取得しました/);
  assert.equal(h.element("line-connection").classList.contains("line-fetch-failed"), false);
  assert.match(h.element("line-updated").textContent, /2026-11-05/);
});
test("out of order results and errors cannot overwrite the current date", async () => {
  for (const fail of [false, true]) {
    const h = harness();
    const requests = [];
    h.context.fetch = () => new Promise((resolve, reject) => requests.push({ resolve, reject }));
    const old = h.context.refreshLineState();
    await new Promise(resolve => setImmediate(resolve));
    h.setDate("2026-11-06");
    const current = h.context.refreshLineState();
    await new Promise(resolve => setImmediate(resolve));
    requests[1].resolve({ ok: true, json: async () => clone(initial) });
    await current;
    if (fail) requests[0].reject(new Error("old error"));
    else requests[0].resolve({ ok: true, json: async () => clone(initial) });
    await old;
    assert.match(h.element("line-status").textContent, /取得しました/);
    assert.match(h.element("line-updated").textContent, /2026-11-06/);
    assert.equal(vm.runInContext("loadedDate", h.context), "2026-11-06");
  }
});
test("clearing the date invalidates the state without requesting the API", async () => {
  const h = harness();
  await h.context.refreshLineState();
  const calls = h.calls.length;
  h.setDate("");
  await h.context.refreshLineState();
  assert.equal(h.calls.length, calls);
  assert.equal(vm.runInContext("state", h.context), undefined);
  assert.match(h.element("line-status").textContent, /日付を選択/);
});
function mountCard(h, group) {
  const badge = { dataset: {} };
  const message = { dataset: {} };
  const other = { dataset: {}, open: true, querySelector() { return null; } };
  const resend = {
    children: [],
    replaceChildren() { this.children = []; },
    append(...children) { this.children.push(...children); },
  };
  const card = {
    dataset: { group: group.id }, children: [],
    querySelector(selector) {
      if (selector === "[data-current-message]") return message;
      if (selector === "[data-line-badge]") return badge;
      if (selector === "[data-other-actions]") return other;
      if (selector === "[data-line-resend]") return resend;
      if (selector === "[data-line-actions]") return this;
      if (selector === "[data-line-card]") return this.children[0] || null;
      return null;
    },
    append(control) { this.children.push(control); },
  };
  h.element("cards").querySelectorAll = () => [card];
  h.options.groups = () => [group];
  h.context.document.createElement = () => ({
    dataset: {}, children: [],
    append(...children) { this.children.push(...children); },
    remove() { card.children = []; },
  });
  return { card, badge, message, other, resend, actions: () => card.children[0].children };
}
test("send confirmation is enabled only after current state is loaded for registered recipients", async () => {
  const h = harness();
  const { card } = mountCard(h, { id: "p1", recipients: names, entries: [] });
  let finish;
  h.context.fetch = () => new Promise(resolve => { finish = resolve; });
  const pending = h.context.refreshLineState();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(card.children[0].children[0].disabled, true);
  finish({ ok: true, json: async () => clone(initial) });
  await pending;
  assert.equal(card.children[0].children[0].disabled, false);
  h.context.fetch = async () => ({ ok: true, json: async () => ({ ...clone(initial), members: [clone(initial.members[0])] }) });
  await h.context.refreshLineState();
  assert.equal(card.children[0].children[0].disabled, true);
  assert.match(card.children[0].children[1].textContent, /Part B/);
});
test("the accepted card shows the exact sent text and history, and promotes an update only after a revision change", async () => {
  const h = harness();
  const group = { id: "p1", recipients: names, entries: [{ id: "p1", plan: { updated_at: "v1" } }] };
  const { badge, message, other, resend, actions } = mountCard(h, group);
  const sent = { ...clone(job), recorded: true, results: Object.fromEntries(
    names.map(name => [name, { status: "accepted" }]),
  ) };
  const unrelated = { ...sent, id: "other", targets: [{ id: "other", plan_revision: "v1" }], message: "Other trip" };
  h.setState({ ...initial, jobs: [sent, unrelated] });
  let focused = false;
  const history = h.element("line-job-job");
  history.querySelector = () => ({ focus() { focused = true; }, scrollIntoView() {} });
  await h.context.refreshLineState();
  assert.equal(badge.textContent, "LINE受付済み");
  assert.equal(message.dataset.compact, "true");
  assert.equal(other.open, false);
  assert.equal(resend.children[0].textContent, "再連絡する");
  assert.deepEqual(actions().map(action => action.textContent), ["送信内容・結果を見る"]);
  assert.match(h.element("line-jobs").innerHTML, /id="line-job-job"[\s\S]*?LINE受付 2\/2名[\s\S]*?Bring rain gear/);
  actions()[0].onclick();
  assert.equal(history.open, true);
  assert.equal(focused, true);
  other.open = true;
  h.context.decorateLineCards();
  assert.equal(other.open, true);
  group.entries[0].plan.updated_at = "v2";
  h.context.decorateLineCards();
  assert.match(badge.textContent, /予定変更/);
  assert.equal(message.dataset.compact, "false");
  assert.equal(resend.children.length, 0);
  assert.equal(actions().find(action => action.className === "primary-btn").textContent, "変更後の文面を確認");
});
test("result unknown routes an overlapping recipient to the same history without preparing a new send", async () => {
  const h = harness();
  const group = { id: "new", recipients: [names[0]], entries: [] };
  const { badge, actions } = mountCard(h, group);
  const pending = clone(job);
  pending.results[names[0]].status = "unknown";
  h.setState({ ...initial, jobs: [pending] });
  const history = h.element("line-job-job");
  history.querySelector = () => ({ focus() {}, scrollIntoView() {} });
  await h.context.refreshLineState();
  assert.match(badge.textContent, /結果不明/);
  assert.equal(actions()[0].textContent, "履歴から確認・再試行");
  actions()[0].onclick();
  assert.equal(history.open, true);
  await assert.rejects(h.context.prepare(group), /同じ送信履歴/);
  assert.equal(h.calls.some(call => call.options?.method === "POST"), false);
});
function mountTemplate(h, title, body, names) {
  const fieldset = { querySelectorAll: () => names.map(value => ({ value })) };
  const status = h.element("form-status");
  status.classList.add = name => status.classList.toggle(name, true);
  status.classList.remove = name => status.classList.toggle(name, false);
  const fields = {
    "[data-template-recipients]": fieldset,
    "[data-template-recipients] input:checked": names.map(value => ({ value })),
    "[data-template-text]": { value: body },
    "[data-template-status]": status,
    'button[type="submit"]': {},
  };
  const form = {
    dataset: { title },
    querySelector: selector => fields[selector],
    querySelectorAll: selector => fields[selector],
  };
  h.element("template-list").querySelectorAll = () => [form];
  h.context.renderTemplateRecipients();
  return {
    fieldset, form,
    submit: () => h.element("template-list").onsubmit({ target: form, preventDefault() {} }),
  };
}
test("monthly template confirmation prepares only the submitted card and does not send before confirmation", async () => {
  const h = harness();
  const template = { ...clone(job), kind: "template", title: "Shift reminder", ack_enabled: true, names: [names[0]] };
  h.context.testApi = async (action, req) => {
    if (!action) return { ...initial, jobs: [template] };
    if (action === "template_history") return { jobs: [{ ...template, history_at: 1793836800 }], next_cursor: null };
    h.calls.push([action, clone(req)]);
    return template;
  };
  await h.context.refresh();
  const other = mountTemplate(h, "Other template", "Other body", [names[1]]);
  const card = mountTemplate(h, template.title, "Test only", [names[0]]);
  h.element("template-list").querySelectorAll = () => [other.form, card.form];
  assert.match(card.fieldset.innerHTML, /value="Part A" checked/);
  assert.match(other.fieldset.innerHTML, /value="Part B" checked/);
  vm.runInContext("lineApi=testApi", h.context);
  await card.submit();
  assert.deepEqual(h.calls.find(item => Array.isArray(item)), ["prepare_template", {
    date, names: [names[0]], title: template.title, message: "Test only", confirm_resend: false,
  }]);
  assert.equal(h.element("line-confirm").open, true);
  assert.equal(h.element("line-confirm-ack").hidden, false);
  assert.doesNotMatch(h.element("line-jobs").innerHTML, /Shift reminder/);
  template.results[names[0]] = { status: "accepted", confirmed_at: "2026-11-05T00:00:00Z" };
  await h.context.loadTemplateHistory("refresh");
  assert.match(h.element("template-line-jobs").innerHTML, /Shift reminder[\s\S]*本人確認 1\/1名/);
  assert.match(h.element("template-line-jobs").innerHTML, /本人確認済み（/);
  assert.ok(!h.calls.some(item => Array.isArray(item) && item[0] === "send"));
});
test("template resend uses the displayed send record date and cancellation prevents preparation", async () => {
  const h = harness();
  const date = "2026-11-06";
  h.setDate(date);
  const sent = { ...clone(job), date, kind: "template", recorded: true };
  sent.results[names[0]].status = "accepted";
  h.setState({ ...initial, jobs: [sent] });
  await h.context.refresh();
  const card = mountTemplate(h, "Shift reminder", sent.message, names);
  assert.match(h.element("template-line-date").textContent, /新規送信の記録日：2026-11-06.*作業予定の連絡/);
  let prompt;
  h.context.window.confirm = text => { prompt = text; return false; };
  await card.submit();
  assert.match(prompt, /Part Aには 2026-11-06 分として同じ本文.*別の連絡/);
  assert.doesNotMatch(prompt, /Part B/);
  assert.ok(!h.calls.some(call => call.options?.method === "POST"));
});
test("recent templates append an older page independently of the plan date and close an old job using its own date", async () => {
  const h = harness();
  const recent = { ...clone(job), id: "recent", date: "2026-11-20", kind: "template", title: "Recent",
    history_at: 1795136400, ack_enabled: true };
  const old = { ...clone(recent), id: "old", date: "2026-10-20", title: "Older", history_at: 1792458000 };
  old.results[names[0]].status = "failed";
  const firstCursor = { at: recent.history_at, id: recent.id };
  h.context.testApi = async (action, req, date) => {
    h.calls.push([action, req && clone(req), date]);
    if (action === "template_history") return req.before
      ? { jobs: [old], next_cursor: null }
      : { jobs: [recent], next_cursor: firstCursor };
    if (action === "close") return { ...old, closed: true };
    return initial;
  };
  vm.runInContext("lineApi=testApi", h.context);
  await h.context.loadTemplateHistory();
  const history = h.element("template-line-jobs");
  assert.match(history.innerHTML, /Recent/);
  assert.equal(h.element("template-history-more").hidden, false);
  h.setDate("2026-12-01");
  await h.context.refresh();
  assert.match(history.innerHTML, /Recent/);
  await h.element("template-history-more").onclick();
  assert.deepEqual(h.calls.filter(([action]) => action === "template_history"), [
    ["template_history", {}, undefined], ["template_history", { before: firstCursor }, undefined],
  ]);
  assert.match(history.innerHTML, /Recent[\s\S]+Older[\s\S]+送信失敗 1名/);
  assert.equal(h.element("template-history-more").hidden, true);
  assert.equal(h.element("template-history-status").textContent, "2件表示中");
  await history.onclick({ target: { closest: selector => selector === "[data-line-close]"
    ? { dataset: { lineClose: old.id } } : null } });
  assert.deepEqual(h.calls.find(([action]) => action === "close")[1], {
    date: old.date, job_id: old.id, confirm: true,
  });
  assert.match(h.element("template-focused-job").innerHTML, /Older[\s\S]+終了/);
});
test("a history fetch failure is reported without clearing the loaded page", async () => {
  const h = harness();
  h.context.testApi = async () => ({
    jobs: [{ ...clone(job), kind: "template", title: "Saved template", history_at: 1795136400 }],
    next_cursor: { id: job.id, at: 1795136400 },
  });
  vm.runInContext("lineApi=testApi", h.context);
  await h.context.loadTemplateHistory();
  h.context.testApi = async () => { throw new Error("History unavailable"); };
  vm.runInContext("lineApi=testApi", h.context);
  await h.element("template-history-more").onclick();
  assert.match(h.element("template-line-jobs").innerHTML, /Saved template/);
  assert.match(h.element("template-history-status").textContent, /取得できませんでした.*History unavailable/);
  assert.equal(h.element("template-history-more").disabled, false);
});
test("a different template body needs only ordinary confirmation even with an unfinished send", async () => {
  const h = harness();
  const prior = { ...clone(job), kind: "template", title: "Shift reminder" };
  prior.results[names[0]].status = "unknown";
  h.setState({ ...initial, jobs: [prior] });
  await h.context.refresh();
  const card = mountTemplate(h, prior.title, "Updated shift reminder", [names[0]]);
  h.context.window.confirm = () => assert.fail("different body must not ask for resend confirmation");
  h.context.testApi = async (action, req) => {
    if (!action) return { ...initial, jobs: [prior] };
    h.calls.push([action, clone(req)]);
    return { ...prior, message: req.message };
  };
  vm.runInContext("lineApi=testApi", h.context);
  await card.submit();
  assert.deepEqual(h.calls.find(item => Array.isArray(item)), ["prepare_template", {
    date, names: [names[0]], title: prior.title, message: "Updated shift reminder", confirm_resend: false,
  }]);
  assert.equal(h.element("line-confirm").open, true);
});
test("HTML contains dedicated dialog, private code field and keeps copy workflow", () => {
  const html = readFileSync(join(__dirname, "..", "deploy", "admin", "message", "index.html"), "utf8");
  assert.match(html, /<dialog id="line-confirm"/);
  assert.match(html, /id="line-code-text"[^>]*readonly/);
  assert.match(html, /id="line-refresh"/);
  assert.match(html, /id="direct-plan-link"[^>]*>[^<]+<\/a>\s*<button id="line-management-open"[^>]*aria-controls="line-management"[^>]*>[^<]+<\/button>[\s\S]*<div class="msg-tabs">/);
  assert.match(html, /<dialog id="line-management"[^>]*>[\s\S]*id="line-members"[\s\S]*<\/dialog>/);
  assert.doesNotMatch(html, /<details id="line-management"/);
  assert.match(html, /コピーはLINE送信を意味しません/);
});
test("shared registration dialog refreshes pending approvals and closes without changing the open template draft", async () => {
  const h = harness();
  const draft = "今回だけの編集";
  const card = mountTemplate(h, "Shift reminder", draft, [names[0]]);
  const templateTab = h.element("tab-templates");
  h.element("tab-daily").hidden = true;
  const pending = { id: "p", display_name: "LINE B" };
  h.setState({ ...initial, members: [
    initial.members[0], { ...initial.members[1], linked: false, pending },
  ] });

  await h.element("line-management-open").onclick();
  assert.equal(h.element("line-management").open, true);
  assert.match(h.element("line-members").innerHTML, /Part B[\s\S]+承認待ち[\s\S]+Part A/);
  assert.equal(h.calls[0].options.method, "GET");
  h.setState(initial);
  const fetchState = h.context.fetch;
  let releaseRefresh;
  let markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  h.context.fetch = (...args) => new Promise(resolve => {
    releaseRefresh = () => resolve(fetchState(...args));
    markStarted();
  });
  const updating = h.element("line-management-refresh").onclick();
  await started;
  assert.match(h.element("line-members").innerHTML, /承認待ち/);
  assert.equal(h.element("line-management-controls").inert, true);
  releaseRefresh();
  await updating;
  assert.doesNotMatch(h.element("line-members").innerHTML, /承認待ち/);
  h.element("line-code-text").value = "LINK private-test";
  h.element("line-management-close").onclick();
  assert.equal(h.element("line-management").open, false);
  assert.equal(h.element("line-code-text").value, "");
  assert.equal(h.element("line-management-open").focused, true);
  assert.equal(templateTab.hidden, false);
  assert.equal(h.element("tab-daily").hidden, true);
  assert.equal(card.form.querySelector("[data-template-text]").value, draft);
  assert.match(card.fieldset.innerHTML, /value="Part A" checked/);
});
test("registration fetch errors are visible inside the dialog and can be retried", async () => {
  const h = harness();
  const fetchState = h.context.fetch;
  h.context.fetch = async () => ({ ok: false, json: async () => ({ message: "Unavailable" }) });
  await h.element("line-management-open").onclick();
  assert.match(h.element("line-registration-status").textContent, /Unavailable.*登録状態を更新/);
  assert.equal(h.element("line-registration-status").classList.contains("msg-error"), true);
  h.context.fetch = fetchState;
  await h.element("line-management-refresh").onclick();
  assert.equal(h.element("line-registration-status").classList.contains("msg-error"), false);
  assert.match(h.element("line-members").innerHTML, /Part A/);
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
  await h.context.memberAction("approve", "a");
  assert.deepEqual(h.calls.find(item => Array.isArray(item) && item[0] === "approve")[1], {
    worker: "a", pending_id: "pending-1", confirm: true,
  });
  assert.doesNotMatch(h.element("line-issue-worker").innerHTML, /Part A/);
  h.context.testApi = async (action, req) => {
    if (!action) return { jobs: [], members: [{ worker: "a", name: "Part A", linked: true }, { worker: "b", name: "Part B", linked: false }] };
    h.calls.push([action, clone(req)]);
    return { registration_message: "LINK test-code" };
  };
  vm.runInContext("lineApi=testApi", h.context);
  await h.context.refresh();
  const select = h.element("line-issue-worker");
  assert.doesNotMatch(select.innerHTML, /Part A/);
  assert.match(select.innerHTML, /<option value="b">Part B/);
  assert.doesNotMatch(h.element("line-members").innerHTML, /登録コードを発行/);
  assert.equal(h.element("line-issue").disabled, true);
  select.value = "b";
  select.onchange();
  assert.equal(h.element("line-issue").disabled, false);
  await h.element("line-issue").onclick();
  assert.equal(h.calls.find(item => Array.isArray(item) && item[0] === "issue")[1].worker, "b");
  assert.match(h.element("line-code-label").textContent, /Part Bさん専用/);
  assert.equal(h.element("line-code-text").value, "LINK test-code");
  assert.equal(h.element("line-code").hidden, false);
});
test("reissuing for a pending member requires confirmation before invalidating the old code", async () => {
  const h = harness();
  h.setState({ jobs: [], members: [
    { worker: "a", name: "Part A", linked: false, pending: { id: "p", display_name: "LINE A" } },
  ] });
  h.context.window.confirm = text => {
    assert.match(text, /Part A.*承認待ちは無効/);
    return false;
  };
  await h.context.refresh();
  const select = h.element("line-issue-worker");
  select.value = "a";
  select.onchange();
  await h.element("line-issue").onclick();
  assert.equal(h.calls.filter(item => item.options?.method === "POST").length, 0);
  assert.equal(h.element("line-code").hidden, true);
});
