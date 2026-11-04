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
test("message footer matches daily-plan navigation and carries the selected date to both edit links", () => {
  const elements = Object.fromEntries(["msg-date", "direct-plan-link", "back-plan-link"].map(id => [id, {}]));
  const context = load("message.js", { document: { getElementById: id => elements[id] } });
  for (const date of ["2026-11-05", "2026-11-06"]) {
    elements["msg-date"].value = date;
    context.syncWorkPlanLink();
    assert.equal(elements["direct-plan-link"].href, `/schedule/daily-plan/index.html?date=${date}`);
    assert.equal(elements["back-plan-link"].href, `/schedule/daily-plan/index.html?date=${date}`);
  }
  const html = read("index.html");
  assert.match(html, /id="back-plan-link" class="secondary-btn"/);
  assert.match(html, /href="\/index.html">トップへ戻る<\/a>/);
  assert.doesNotMatch(html, /back-action-slot|unified-back-btn|管理ページへ戻る|シフト管理へ/);
  assert.match(read("message.js"), /renderHeader\(\{ adminPage: true \}\)/);
});
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
function copyScreen({ failCopy = false, failRecord = false, plans = { test: plan } } = {}) {
  const helper = load("message-plan.js");
  const elements = {};
  for (const id of ["cards", "msg-date", "direct-plan-link", "back-plan-link", "msg-login", "tab-daily", "status",
    "common-open", "common-panel", "common-apply", "common-text", "common-status", "page-area", "load-plans",
    "common-all", "common-clear", "common-cancel", "template-list", "template-edit", "add-template", "save-templates"]) {
    elements[id] = { value: "", textContent: "", replaceChildren() {}, classList: { toggle() {} },
      setAttribute(name, value) { this[name] = value; }, querySelectorAll: () => [], focus() {} };
  }
  elements["msg-date"].value = "2026-11-04";
  const cards = helper.messageGroups(plans).map(group => {
    const classes = new Set();
    const select = { setAttribute(name, value) { this[name] = value; } };
    return { dataset: { group: group.id }, select, classes,
      classList: { toggle(name, on) { if (on) classes.add(name); else classes.delete(name); } },
      querySelector: () => select };
  });
  elements.cards.querySelectorAll = () => cards;
  const notice = {};
  const button = { parentElement: { querySelector: () => notice } };
  const events = [];
  const copiedTexts = [];
  const requests = [];
  let initialize;
  const context = load("message.js", {
    hasSession: () => true, document: { getElementById: id => elements[id], querySelectorAll: () => [] },
    ...helper, window: { currentRole: "admin", addEventListener(name, callback) { initialize = callback; } },
    verifyLocalAuth: async () => true, renderHeader() {}, fetch: async () => ({ status: 404 }),
    fetchWorkPlanRecord: async () => ({ date: "2026-11-04", revision: '"etag"', data: { plans, communications: [] } }),
    writeWorkPlan: async req => { events.push("record"); requests.push(req); if (failRecord) throw new Error("offline"); return { saved: true, date: req.date }; },
  });
  context.testPlans = plans;
  context.testCopy = async text => { events.push("copy"); copiedTexts.push(text); if (failCopy) throw new Error("copy failed"); };
  vm.runInContext('record={data:{plans:testPlans,communications:[]}}; loadedDate="2026-11-04"; copyText=testCopy;', context);
  return { context, button, notice, events, elements, cards, copiedTexts, requests, initialize };
}
function defaultDateScreen({ search = "", communications, failDate = "", todayPlans, now = [2026, 10, 4] } = {}) {
  const screen = copyScreen();
  const { context } = screen;
  context.Date = class extends Date {
    constructor(...args) { super(...(args.length ? args : now)); }
  };
  vm.runInContext(strip(readFileSync(join(__dirname, "..", "deploy", "common", "date-utils.js"), "utf8")), context);
  context.location = { search };
  const calls = [];
  context.fetchWorkPlanRecord = async date => {
    calls.push(date);
    if (date === failDate) throw new Error("offline");
    return { date, revision: '"etag"', data: {
      plans: todayPlans ?? { test: plan },
      communications: communications ?? [{ plan_id: "test", plan_revision: plan.updated_at,
        recipients: plan.recipients, status: "copied", at: "copy-time" }],
    } };
  };
  return { ...screen, calls };
}
test("unspecified date opens tomorrow only after all today's exact groups have unchanged copy records", async () => {
  const screen = defaultDateScreen();
  await screen.initialize();
  assert.deepEqual(screen.calls, ["2026-11-04", "2026-11-05"]);
  assert.equal(screen.elements["msg-date"].value, "2026-11-05");
  assert.equal(screen.elements["direct-plan-link"].href, "/schedule/daily-plan/index.html?date=2026-11-05");
  assert.equal(screen.elements["back-plan-link"].href, "/schedule/daily-plan/index.html?date=2026-11-05");
  assert.match(screen.elements.cards.innerHTML, /2026-11-05/);
  assert.deepEqual(screen.events, []);
});
test("missing, changed or wrong-recipient copies and no contact plans keep today", async () => {
  const copied = { plan_id: "test", plan_revision: plan.updated_at, recipients: plan.recipients, status: "copied", at: "copy" };
  for (const options of [
    { communications: [] },
    { communications: [{ ...copied, plan_revision: "old" }] },
    { communications: [{ ...copied, recipients: ["別の人"] }] },
    { todayPlans: {} },
    { todayPlans: { family: { ...plan, recipients: [] } } },
    { todayPlans: { test: plan, second: { ...plan, recipients: ["B"], names: ["B"] } } },
  ]) {
    const screen = defaultDateScreen(options);
    await screen.initialize();
    assert.deepEqual(screen.calls, ["2026-11-04"], JSON.stringify(options));
    assert.equal(screen.elements["msg-date"].value, "2026-11-04");
  }
});
test("explicit dates, manual reloads and date changes never auto-advance", async () => {
  for (const date of ["2026-11-04", "2026-11-03", "2026-11-06"]) {
    const screen = defaultDateScreen({ search: `?date=${date}` });
    await screen.initialize();
    assert.deepEqual(screen.calls, [date]);
    assert.equal(screen.elements["msg-date"].value, date);
  }
  const screen = defaultDateScreen();
  await screen.initialize();
  screen.elements["msg-date"].value = "2026-11-04";
  await screen.elements["msg-date"].onchange({ type: "change" });
  await screen.elements["load-plans"].onclick({ type: "click" });
  assert.deepEqual(screen.calls, ["2026-11-04", "2026-11-05", "2026-11-04", "2026-11-04"]);
});
test("time-split recipients must each have a current communication before advancing", async () => {
  const shared = { ...plan, names: ["A", "B"], recipients: ["A", "B"],
    attendance: { A: [{ start: "08:00", end: "16:00" }], B: [{ start: "13:00", end: "16:00" }] } };
  const copies = ["A", "B"].map((name, index) => ({ plan_id: "shared", plan_revision: shared.updated_at,
    recipients: [name], status: index ? "sent" : "copied", at: `copy-${name}` }));
  for (const [communications, expected] of [[copies.slice(0, 1), "2026-11-04"], [copies, "2026-11-05"]]) {
    const screen = defaultDateScreen({ todayPlans: { shared }, communications });
    await screen.initialize();
    assert.equal(screen.elements["msg-date"].value, expected);
  }
});
test("load failures show an error without silently skipping today or retrying past tomorrow", async () => {
  for (const date of ["2026-11-04", "2026-11-05"]) {
    const screen = defaultDateScreen({ failDate: date });
    await screen.initialize();
    assert.equal(screen.elements["msg-date"].value, date);
    assert.match(screen.elements.status.textContent, /offline.*再試行/);
    assert.deepEqual(screen.calls, date.endsWith("04") ? ["2026-11-04"] : ["2026-11-04", "2026-11-05"]);
  }
});
test("automatic tomorrow selection uses local calendar arithmetic across month and year boundaries", async () => {
  for (const [now, expected] of [[[2026, 11, 31], "2027-01-01"], [[2028, 1, 28], "2028-02-29"]]) {
    const screen = defaultDateScreen({ now });
    await screen.initialize();
    assert.equal(screen.elements["msg-date"].value, expected);
    assert.equal(screen.calls.length, 2);
  }
});
test("a stale initial fetch cannot override a manual date selection", async () => {
  const screen = defaultDateScreen();
  const fetchRecord = screen.context.fetchWorkPlanRecord;
  let finish;
  screen.context.fetchWorkPlanRecord = date => date === "2026-11-04"
    ? new Promise(resolve => { finish = async () => resolve(await fetchRecord(date)); }) : fetchRecord(date);
  const initializing = screen.initialize();
  await new Promise(resolve => setImmediate(resolve));
  screen.elements["msg-date"].value = "2026-11-06";
  await screen.elements["msg-date"].onchange();
  await finish();
  await initializing;
  assert.equal(screen.elements["msg-date"].value, "2026-11-06");
  assert.match(screen.elements.cards.innerHTML, /2026-11-06/);
  assert.ok(!screen.calls.includes("2026-11-05"));
});
test("common additions preserve edited content and go before the last closing line, or append without one", () => {
  const { appendCommonMessage: add } = load("message.js");
  assert.equal(add("時間変更済み\n\nよろしくお願いします。", "かっぱを持ってきてください。"),
    "時間変更済み\n\nかっぱを持ってきてください。\n\nよろしくお願いします。");
  assert.equal(add("よろしくお願いします。\n作業内容\nよろしくお願いします。\n追伸", "注意"),
    "よろしくお願いします。\n作業内容\n\n注意\n\nよろしくお願いします。\n追伸");
  assert.equal(add("独自の結び", "注意"), "独自の結び\n\n注意");
  assert.equal(add("", "注意"), "注意");
  assert.equal(add("本文\r\n\r\nよろしくお願いします。\r\n", "注意"),
    "本文\r\n\r\n注意\r\n\r\nよろしくお願いします。\r\n");
});
function commonScreen() {
  const personPlan = (name, start, task) => ({ ...structuredClone(plan), names: [name], recipients: [name],
    attendance: { [name]: [{ start, end: "16:00" }] },
    blocks: [{ ...plan.blocks[0], start, end: "16:00", task }] });
  return copyScreen({ plans: {
    a: personPlan("A", "08:00", "草とり"),
    b: personPlan("B", "13:00", "草とり"),
    c: personPlan("C", "08:00", "収穫"),
  } });
}
function clickCard(context, card, { interactive = false, select = false } = {}) {
  context.handleCardClick({ target: { closest(selector) {
    if (selector === "[data-group]") return card;
    if (selector === "[data-select]") return select ? card.select : null;
    if (selector === "button, a, textarea, input, select, label") return interactive ? {} : null;
    return null;
  } } });
}
test("card selection is mode-only, reversible and does not interfere with editing", () => {
  const { context, cards, elements } = commonScreen();
  context.renderCards();
  clickCard(context, cards[0]);
  assert.equal(cards[0].classes.has("selected"), false);
  assert.equal(cards[0].select.hidden, true);
  context.setCommonMode(true);
  assert.equal(elements["common-panel"].hidden, false);
  assert.equal(elements["common-open"]["aria-expanded"], "true");
  clickCard(context, cards[0], { interactive: true });
  assert.equal(cards[0].select["aria-pressed"], "false");
  clickCard(context, cards[0]);
  assert.equal(cards[0].classes.has("selected"), true);
  assert.equal(cards[0].select["aria-pressed"], "true");
  assert.equal(elements["common-apply"].textContent, "選択した1件に追加");
  clickCard(context, cards[0], { select: true });
  assert.equal(cards[0].classes.has("selected"), false);
  context.selectCommonCards(true);
  assert.ok(cards.every(card => card.classes.has("selected")));
  context.selectCommonCards(false);
  assert.ok(cards.every(card => !card.classes.has("selected")));
  context.setCommonMode(false);
  assert.equal(elements["common-panel"].hidden, true);
  assert.ok(cards.every(card => card.select.hidden));
});
test("shared notes target two time-split cards and all-task cards without changing plans or other drafts", async () => {
  const { context, cards, elements, events, button, copiedTexts, requests } = commonScreen();
  const before = JSON.stringify(context.testPlans);
  vm.runInContext('drafts.set("a", buildGroupMessage(messageGroups(record.data.plans).find(g=>g.id==="a"),loadedDate).replace("お疲れさまです。","手直し済み"));', context);
  context.setCommonMode(true);
  clickCard(context, cards[0]);
  clickCard(context, cards[1]);
  elements["common-text"].value = "かっぱを持ってきてください。";
  context.applyCommonMessage();
  for (const id of ["a", "b"]) {
    const text = vm.runInContext(`drafts.get("${id}")`, context);
    assert.match(text, /かっぱを持ってきてください。\n\nよろしくお願いします。/);
    assert.match(text, id === "a" ? /出勤：08:00/ : /出勤：13:00/);
  }
  assert.match(vm.runInContext('drafts.get("a")', context), /手直し済み/);
  assert.equal(vm.runInContext('drafts.has("c")', context), false);
  assert.deepEqual(events, []);
  context.setCommonMode(true);
  context.selectCommonCards(true);
  elements["common-text"].value = "熱中症に注意してください。";
  context.applyCommonMessage();
  for (const id of ["a", "b", "c"]) assert.match(vm.runInContext(`drafts.get("${id}")`, context), /熱中症/);
  assert.match(vm.runInContext('drafts.get("c")', context), /収穫/);
  assert.match(vm.runInContext('drafts.get("a")', context), /かっぱ.*\n\n熱中症/);
  assert.equal(JSON.stringify(context.testPlans), before);
  assert.equal(elements["common-panel"].hidden, true);
  await context.copySavedPlan("a", button);
  assert.match(copiedTexts[0], /かっぱ/);
  assert.match(requests[0].message, /熱中症/);
  assert.equal(requests[0].plan, undefined);
  assert.match(elements.cards.innerHTML, /かっぱ/);
  assert.equal(JSON.stringify(context.testPlans), before);
});
test("empty selection or note and oversized batches fail explicitly without partial updates", () => {
  const { context, elements } = commonScreen();
  context.setCommonMode(true);
  elements["common-text"].value = "注意";
  context.applyCommonMessage();
  assert.match(elements["common-status"].textContent, /カードを選択/);
  context.selectCommonCards(true);
  elements["common-text"].value = "  \n ";
  context.applyCommonMessage();
  assert.match(elements["common-status"].textContent, /内容を入力/);
  vm.runInContext('drafts.set("b","x".repeat(9999));', context);
  elements["common-text"].value = "注意";
  context.applyCommonMessage();
  assert.match(elements["common-status"].textContent, /10000文字/);
  assert.equal(vm.runInContext('drafts.has("a")', context), false);
  assert.equal(vm.runInContext('drafts.get("b").length', context), 9999);
  vm.runInContext('drafts.set("b","x".repeat(9996));', context);
  context.applyCommonMessage();
  assert.equal(vm.runInContext('drafts.get("b").length', context), 10000);
});
test("one shared plan with different attendance creates independently selectable cards and copies the right recipients", async () => {
  const shared = { ...structuredClone(plan), names: ["A", "B"], recipients: ["A", "B"],
    attendance: { A: [{ start: "08:00", end: "16:30" }], B: [{ start: "13:00", end: "16:30" }] },
    blocks: [{ ...plan.blocks[0], start: "08:00", end: "16:30", participation: {
      A: [{ start: "08:00", end: "12:00" }, { start: "13:00", end: "16:30" }],
      B: [{ start: "13:00", end: "16:30" }],
    } }] };
  const { context, cards, elements, button, requests } = copyScreen({ plans: { shared } });
  assert.equal(cards.length, 2);
  assert.notEqual(cards[0].dataset.group, cards[1].dataset.group);
  context.setCommonMode(true);
  context.selectCommonCards(true);
  elements["common-text"].value = "かっぱを持ってきてください。";
  context.applyCommonMessage();
  const helper = load("message-plan.js");
  const groups = helper.messageGroups({ shared });
  for (const group of groups) {
    const text = vm.runInContext(`drafts.get(${JSON.stringify(group.id)})`, context);
    assert.match(text, /かっぱを持ってきてください。\n\nよろしくお願いします。/);
    assert.match(text, group.recipients[0] === "A" ? /出勤：08:00/ : /出勤：13:00/);
  }
  await context.copySavedPlan(groups[1].id, button);
  assert.deepEqual(Array.from(requests[0].recipients), ["B"]);
  assert.equal(requests[0].copies[0].id, "shared");
  assert.match(requests[0].message, /出勤：13:00/);
  assert.doesNotMatch(requests[0].message, /出勤：08:00/);
});
test("refreshing cards removes stale selections rather than reporting a zero-card success", () => {
  const { context, elements } = commonScreen();
  context.setCommonMode(true);
  context.selectCommonCards(true);
  vm.runInContext("delete record.data.plans.b;", context);
  elements["common-text"].value = "注意";
  context.applyCommonMessage();
  assert.match(elements["common-status"].textContent, /予定が変わりました/);
  assert.equal(vm.runInContext("drafts.size", context), 0);
  assert.equal(elements["common-apply"].textContent, "選択した2件に追加");
});
test("cancel does not change drafts and reload clears selections and unsaved shared notes", async () => {
  const { context, elements, cards } = commonScreen();
  context.setCommonMode(true);
  context.selectCommonCards(true);
  elements["common-text"].value = "追加しない";
  context.setCommonMode(false);
  assert.equal(vm.runInContext("drafts.size", context), 0);
  context.setCommonMode(true);
  context.selectCommonCards(true);
  context.applyCommonMessage();
  context.setCommonMode(true);
  context.selectCommonCards(true);
  await context.loadSavedPlans();
  assert.equal(vm.runInContext("drafts.size", context), 0);
  assert.equal(elements["common-text"].value, "");
  assert.equal(elements["common-panel"].hidden, true);
  assert.ok(cards.every(card => !card.classes.has("selected")));
  context.testPlans = {};
  vm.runInContext('record={data:{plans:{},communications:[]}};', context);
  context.renderCards();
  assert.equal(elements["common-open"].disabled, true);
});
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
test("reopening restores the latest saved message and copies it without losing common notes", async () => {
  const { context, elements, button, copiedTexts, requests } = copyScreen();
  const saved = "手修正した連絡文\n\nかっぱを持ってきてください。\n\nよろしくお願いします。";
  const communications = [
    { plan_id: "test", plan_revision: plan.updated_at, recipients: plan.recipients,
      at: "2026-11-04T06:43:00Z", status: "copied", message: saved },
    { plan_id: "test", plan_revision: plan.updated_at, recipients: plan.recipients,
      at: "2026-11-04T06:42:00Z", status: "copied", message: "古い注意" },
  ];
  context.fetchWorkPlanRecord = async () => ({ date: "2026-11-04", revision: '"etag"',
    data: { plans: { test: plan }, communications } });
  await context.loadSavedPlans();
  assert.match(elements.cards.innerHTML, /かっぱを持ってきてください/);
  assert.match(elements.cards.innerHTML, /最新の控えから文面を復元/);
  await context.copySavedPlan("test", button);
  assert.equal(copiedTexts[0], saved);
  assert.equal(requests[0].message, saved);
  context.setCommonMode(true);
  context.selectCommonCards(true);
  elements["common-text"].value = "熱中症に注意してください。";
  context.applyCommonMessage();
  const draft = vm.runInContext('drafts.get("test")', context);
  assert.match(draft, /かっぱ.*\n\n熱中症.*\n\nよろしく/);
  context.handleCardClick({ target: { closest: selector => selector === "[data-reset]"
    ? { dataset: { reset: "test" } } : null } });
  assert.doesNotMatch(vm.runInContext('drafts.get("test")', context), /かっぱ|手修正|熱中症/);
  await context.copySavedPlan("test", button);
  assert.doesNotMatch(copiedTexts[1], /かっぱ/);
  await context.loadSavedPlans();
  assert.match(elements.cards.innerHTML, /かっぱ/);
  assert.equal(communications[0].message, saved);
});
test("restoration never reuses a different recipient, changed revision or superseded plan set", () => {
  const helper = load("message-plan.js");
  const group = helper.messageGroups({ test: plan })[0];
  const item = { plan_id: "test", plan_revision: plan.updated_at, recipients: plan.recipients,
    at: "2026-11-04T06:43:00Z", status: "copied", message: "雨具のお願い" };
  assert.equal(helper.groupCommunicationState(group, [item]).message, item.message);
  assert.equal(helper.groupCommunicationState(group, [{ ...item, recipients: ["別の人"] }]), null);
  assert.equal(helper.groupCommunicationState(group, [{ ...item, plan_revision: "old" }]).message, null);
  assert.equal(helper.groupCommunicationState(group, [item, { ...item, plan_id: "deleted" }]).message, null);
  assert.equal(helper.groupCommunicationState(group, [
    { ...item, at: "2026-11-04T06:42:00Z" }, { ...item, plan_revision: "changed" },
  ]).message, null);
  const multiple = helper.messageGroups({ test: plan, second: plan })[0];
  assert.equal(helper.groupCommunicationState(multiple, [item]), null);
  const full = [item, { ...item, plan_id: "second" }];
  assert.equal(helper.groupCommunicationState(multiple, full).message, item.message);
  assert.equal(helper.groupCommunicationState(multiple, [item, { ...item, plan_id: "second", message: "不一致" }]).message, null);
  assert.equal(helper.groupCommunicationState(multiple, [
    ...full, { ...item, at: "2026-11-04T06:44:00Z" },
  ]), null);
});
test("changed plans show fresh text and a history warning instead of restoring old times", () => {
  const { context, elements } = copyScreen();
  context.savedCopy = { plan_id: "test", plan_revision: "old", recipients: plan.recipients,
    at: "2026-11-04T06:43:00Z", status: "copied", message: "古い作業時間とかっぱの注意" };
  vm.runInContext("record.data.communications=[savedCopy]; renderCards();", context);
  assert.match(elements.cards.innerHTML, /現在の予定から文面を作り直しました/);
  assert.match(elements.cards.innerHTML, /連絡時点の控え/);
  assert.doesNotMatch(elements.cards.innerHTML, /古い作業時間/);
  vm.runInContext('drafts.set("test","編集中の文面");renderCards();', context);
  assert.match(elements.cards.innerHTML, /編集中の文面/);
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
