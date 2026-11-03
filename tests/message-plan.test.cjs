const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const read = file => readFileSync(join(__dirname, "..", "deploy", "admin", "message", file), "utf8");
function load(file, dependencies = {}) {
  const context = vm.createContext({ console: { error() {} }, structuredClone, ...dependencies });
  vm.runInContext(read(file).replace(/^import[\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""), context);
  return context;
}
function card() {
  return {
    names: [{ name: "担当A", wish: false }, { name: "担当B", wish: true }],
    blocks: [{ start: "08:00", end: "12:00", task: "播種", field: "テスト圃場", shed: false }],
    off: false, offReason: "雨天", kind: "2", reporter: "担当A", memo: "テスト", manualText: null,
  };
}

test("plan snapshots preserve structured fields separately from manually edited text", () => {
  const context = load("message-plan.js");
  const original = card();
  original.manualText = "手修正文面";
  const result = context.createMessagePlan(original, original.manualText);
  assert.deepEqual(Array.from(result.names), ["担当A", "担当B"]);
  assert.equal(result.manual_text, true);
  assert.equal(result.message, "手修正文面");
  assert.equal(result.blocks[0].task, "播種");
  original.blocks[0].task = "変更";
  original.names[0].name = "変更";
  assert.equal(result.blocks[0].task, "播種");
  assert.equal(result.names[0], "担当A");
});

test("cancellation has no active work blocks and invalid work cannot be copied as a plan", () => {
  const context = load("message-plan.js");
  const off = card();
  off.off = true;
  off.blocks[0].task = "";
  const result = context.createMessagePlan(off, "お休み");
  assert.equal(result.blocks.length, 0);
  assert.equal(result.off, true);
  for (const change of [{ start: "24:00" }, { end: "08:00" }, { task: " " }]) {
    const invalid = card();
    Object.assign(invalid.blocks[0], change);
    assert.throws(() => context.createMessagePlan(invalid, "文面"), /作業内容と開始/);
  }
  const duplicate = card();
  duplicate.names[1].name = duplicate.names[0].name;
  assert.throws(() => context.createMessagePlan(duplicate, "文面"), /重複なく/);
});

test("persistence reads current revision and only updates the copied group", async () => {
  const context = load("message-plan.js");
  const plan = context.createMessagePlan(card(), "文面");
  let received;
  await context.persistMessagePlan("2026-11-02", plan,
    async (path, query) => {
      assert.equal(path, "/shift/work-plans");
      assert.equal(query.date, "2026-11-02");
      return { date: query.date, revision: '"revision"' };
    },
    async (path, body) => {
      received = body;
      assert.equal(path, "/shift/work-plans");
      return { saved: true, date: body.date };
    });
  assert.equal(received.revision, '"revision"');
  assert.equal(received.plan, plan);
});

test("persistence does not overwrite on failed reads and rejects uncertain writes", async () => {
  const context = load("message-plan.js");
  let posts = 0;
  for (const get of [
    async () => { throw new Error("offline"); },
    async () => ({ date: "2026-11-02" }),
  ]) {
    await assert.rejects(context.persistMessagePlan("2026-11-02", {}, get, async () => { posts++; }));
  }
  assert.equal(posts, 0);
  await assert.rejects(context.persistMessagePlan("2026-11-02", {},
    async () => ({ date: "2026-11-02", revision: null }),
    async () => ({ saved: false })), /保存完了/);
});

function copyContext({ session = true, copyFailure = false, saveFailure = false } = {}) {
  const helper = load("message-plan.js");
  const notice = { textContent: "" };
  const button = { disabled: false, parentElement: { querySelector: () => notice } };
  const statuses = [];
  const events = [];
  const context = load("message.js", {
    window: { addEventListener() {} },
    document: { getElementById: id => id === "msg-date" ? { value: "2026-11-02" } : {} },
    hasSession: () => session,
    createMessagePlan: helper.createMessagePlan,
    persistMessagePlan: async (date, plan) => {
      events.push("save");
      assert.equal(date, "2026-11-02");
      assert.equal(plan.message, "文面");
      if (saveFailure) throw new Error("保存失敗");
    },
  });
  context.testCopy = async () => { events.push("copy"); if (copyFailure) throw new Error("コピー失敗"); };
  context.testStatus = (message, error) => statuses.push({ message, error });
  context.testRemember = () => events.push("remember");
  vm.runInContext("copyText = testCopy; status = testStatus; rememberSent = testRemember; buildText = () => '文面';", context);
  return { context, notice, button, events, statuses };
}

test("copy then save reports success without claiming LINE delivery", async () => {
  const { context, notice, button, events } = copyContext();
  await context.copyAndSavePlan(card(), button);
  assert.deepEqual(events, ["copy", "save", "remember"]);
  assert.match(notice.textContent, /予定保存済み.*LINE送信はしていません/);
  assert.equal(button.disabled, false);
});

test("copy success with save failure stays explicitly retryable; failed copy never saves", async () => {
  for (const options of [{ saveFailure: true }, { copyFailure: true }, { session: false }]) {
    const { context, notice, button, events, statuses } = copyContext(options);
    await context.copyAndSavePlan(card(), button);
    assert.equal(button.disabled, false);
    assert.equal(statuses.at(-1).error, true);
    if (options.saveFailure) {
      assert.deepEqual(events, ["copy", "save"]);
      assert.match(notice.textContent, /コピー済みですが、予定は保存できませんでした/);
    } else {
      assert.ok(!events.includes("save"));
    }
  }
});

test("repeated clicks while saving do not start a second copy or write", async () => {
  const { context, button, events } = copyContext();
  let finish;
  context.persistMessagePlan = () => new Promise(resolve => { finish = resolve; });
  const pending = context.copyAndSavePlan(card(), button);
  await Promise.resolve();
  await context.copyAndSavePlan(card(), button);
  assert.deepEqual(events, ["copy"]);
  finish();
  await pending;
  assert.equal(button.disabled, false);
});

test("clipboard fallback checks success and always removes the temporary field", async () => {
  for (const success of [true, false]) {
    let removed = false;
    const context = load("message.js", {
      window: { addEventListener() {} },
      navigator: { clipboard: { writeText: async () => { throw new Error("blocked"); } } },
      document: {
        body: { appendChild() {} },
        createElement: () => ({ select() {}, remove: () => { removed = true; } }),
        execCommand: () => success,
      },
      setTimeout() {},
    });

    const button = { textContent: "コピー", classList: { add() {}, remove() {} } };
    if (success) {
      await context.copyText("文面", button);
      assert.equal(button.textContent, "✓ コピーしました");
    } else {
      await assert.rejects(context.copyText("文面", button), /コピーできませんでした/);
      assert.equal(button.textContent, "コピー");
    }
    assert.equal(removed, true);
  }
});

test("task selector retains all choices for a populated task and preserves custom input", () => {
  const container = { innerHTML: "" };
  const context = load("message.js", {
    window: { addEventListener() {} },
    document: { getElementById: () => container },
  });
  context.testCard = card();
  vm.runInContext("cards = [testCard]; buildText = () => '文面'; renderCards();", context);
  assert.match(container.innerHTML, /<select[^>]+data-k="taskChoice"/);
  assert.match(container.innerHTML, /value="播種" selected/);
  assert.match(container.innerHTML, /value="収穫"/);
  assert.match(container.innerHTML, /value="草とり"/);
  assert.doesNotMatch(container.innerHTML, /list="dl-tasks"/);
  context.testCard.blocks[0].task = "独自の作業";
  context.renderCards();
  assert.match(container.innerHTML, /value="__custom__" selected/);
  assert.match(container.innerHTML, /data-k="task" value="独自の作業"/);
});

test("work plan link follows the selected month and opens without losing the message draft", () => {
  const date = { value: "2026-11-02" };
  const link = {};
  const context = load("message.js", {
    window: { addEventListener() {} },
    document: { getElementById: id => id === "msg-date" ? date : link },
  });
  context.syncWorkPlanLink();
  assert.equal(link.href, "/schedule/work-plan/index.html?ym=2026-11");
  date.value = "2027-01-03";
  context.syncWorkPlanLink();
  assert.equal(link.href, "/schedule/work-plan/index.html?ym=2027-01");
  date.value = "";
  context.syncWorkPlanLink();
  assert.equal(link.href, "/schedule/work-plan/index.html");
  assert.match(read("index.html"), /id="work-plan-link"[\s\S]*?target="_blank" rel="noopener"/);
});
