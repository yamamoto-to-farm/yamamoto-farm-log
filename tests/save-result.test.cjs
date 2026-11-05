const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const root = join(__dirname, "..", "deploy");
const read = file => readFileSync(join(root, ...file.split("/")), "utf8");
const strip = source => source.replace(/^import[\s\S]*?;\r?\n/gm, "").replace(/^export /gm, "");

function harness() {
  const nodes = [];
  const context = vm.createContext({
    document: {
      body: { appendChild() {} },
      createElement(tag) {
        const listeners = {};
        const node = {
          tag, style: {}, children: [], setAttribute(key, value) { this[key] = value; },
          append(...children) { this.children.push(...children); },
          addEventListener(name, callback) { listeners[name] = callback; },
          showModal() { this.open = true; }, focus() { this.focused = true; },
          close() { this.open = false; listeners.close(); },
          remove() { this.removed = true; },
        };
        nodes.push(node);
        return node;
      },
    },
  });
  vm.runInContext(strip(read("common/save-modal.js")), context);
  return { context, nodes };
}

test("save result is a top-layer dialog, uses text, waits for OK and never reloads", async () => {
  const { context, nodes } = harness();
  let acknowledged = false;
  const result = context.showSaveResult("<img onerror=alert(1)>\n保存しました。")
    .then(() => { acknowledged = true; });
  const [dialog, text, button] = nodes;
  assert.equal(dialog.tag, "dialog");
  assert.equal(dialog.open, true);
  assert.equal(dialog["aria-label"], "保存結果");
  assert.equal(text.textContent, "<img onerror=alert(1)>\n保存しました。");
  assert.equal(button.focused, true);
  await Promise.resolve();
  assert.equal(acknowledged, false);
  button.onclick();
  await result;
  assert.equal(acknowledged, true);
  assert.equal(dialog.removed, true);
});

test("dismissal cleans up the result dialog and permits another result", async () => {
  const { context, nodes } = harness();
  const first = context.showSaveResult("入力は残しています。");
  nodes[0].close();
  await first;
  const second = context.showSaveResult("保存しました。");
  assert.equal(nodes[3].open, true);
  nodes[5].onclick();
  await second;
  assert.equal(nodes[3].removed, true);
});

test("recent explicit save screens all import the common result modal", () => {
  for (const file of [
    "machines/machines.js", "schedule/daily-plan/daily-plan.js",
    "schedule/work-plan/work-plan.js", "admin/message/message.js",
    "admin/shift/config-page.js", "finance/finance.js",
  ]) {
    assert.match(read(file), /import \{ showSaveResult \} from "\/common\/save-modal.js\?v=20261105-result-1"/, file);
    assert.match(read(file), /await showSaveResult\(/, file);
  }
});

test("monthly work plan reports success only after PUT, preserves draft on failure and blocks duplicate saves", async () => {
  const button = { disabled: false };
  const messages = [];
  let fail = false, uploads = 0;
  const context = vm.createContext({
    console: { error() {} }, window: { addEventListener() {} },
    document: { getElementById: id => id === "save" ? button : { value: "memo" } },
    showSaveResult: async message => messages.push(message),
    fetch: async (url, options) => {
      if (options.method === "PUT") { uploads++; return { ok: !fail, status: fail ? 500 : 200 }; }
      return { ok: true, json: async () => ({ url: "https://fixture.invalid" }) };
    },
  });
  vm.runInContext(strip(read("schedule/work-plan/work-plan.js")), context);
  vm.runInContext('status=()=>{}; ym="2026-11"; data={days:{}}; dirty=true; loadReady=true;', context);
  const pending = context.save();
  await context.save();
  await pending;
  assert.equal(uploads, 1);
  assert.equal(vm.runInContext("dirty", context), false);
  assert.match(messages.at(-1), /保存しました/);
  fail = true;
  vm.runInContext("dirty=true", context);
  await context.save();
  assert.equal(vm.runInContext("dirty", context), true);
  assert.match(messages.at(-1), /入力は残しています/);
  assert.equal(button.disabled, false);
});

test("template completion appears only after the actual template upload succeeds", async () => {
  const messages = [];
  let success = true;
  const context = vm.createContext({
    window: { addEventListener() {} }, console, structuredClone, DEFAULT_TEMPLATES: [],
    showSaveResult: async message => messages.push(message),
    fetch: async (url, options) => options.method === "PUT"
      ? { ok: success, status: success ? 200 : 500 }
      : { ok: true, json: async () => ({ url: "https://fixture.invalid" }) },
  });
  vm.runInContext(strip(read("admin/message/message.js")), context);
  vm.runInContext("masters={templates:[]}; status=()=>{};", context);
  await context.saveMasters();
  assert.deepEqual(messages, ["定型文を保存しました。"]);
  success = false;
  await assert.rejects(context.saveMasters(), /保存に失敗/);
  assert.equal(messages.length, 1);
});

test("shift configuration waits for save acknowledgement before offering regeneration", async () => {
  const nodes = { save: { disabled: false }, "save-result": { textContent: "" } };
  const messages = [];
  let acknowledge, regenerated = false, fail = false;
  const context = vm.createContext({
    window: { addEventListener() {} }, confirm: () => true,
    document: { getElementById: id => nodes[id] },
    showSaveResult: message => {
      messages.push(message);
      return new Promise(resolve => { acknowledge = resolve; });
    },
    markRegenerated: () => { regenerated = true; },
    saveFixture: async () => {
      if (fail) throw new Error("network error");
      return { staff: 2 };
    },
  });
  vm.runInContext(strip(read("admin/shift/config-page.js")), context);
  vm.runInContext("cfg={}; collectGlobals=()=>{}; collectStaff=()=>[]; api=saveFixture; offerRegenerate=async()=>markRegenerated();", context);
  const pending = context.save();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(messages[0], /設定を保存しました/);
  assert.equal(regenerated, false);
  await context.save();
  assert.equal(messages.length, 1);
  acknowledge();
  await pending;
  assert.equal(regenerated, true);
  assert.equal(nodes.save.disabled, false);
  fail = true;
  const failed = context.save();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(messages.at(-1), /保存を確認できません/);
  acknowledge();
  await failed;
  assert.equal(nodes.save.disabled, false);
});
