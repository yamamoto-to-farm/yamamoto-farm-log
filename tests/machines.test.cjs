const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { randomUUID } = require("node:crypto");
const { test } = require("node:test");
const vm = require("node:vm");
const root = join(__dirname, "..", "deploy");
const read = path => readFileSync(join(root, ...path.split("/")), "utf8");
const source = read("machines/machines.js").replace(/^import[\s\S]*?;\r?\n/gm, "").replace(/^export /gm, "");
const clone = value => JSON.parse(JSON.stringify(value));
const initial = {
  machine: { id: "SL350", name: "Tractor" }, revision: null, canEdit: true,
  record: { machineId: "SL350", entries: [], assets: {} },
};

async function harness({ detail = true, canEdit = true, entries = [], assets = {} } = {}) {
  const nodes = new Map();
  const listeners = {};
  const calls = [];
  let state = clone({ ...initial, canEdit, record: { ...initial.record, entries, assets } });
  let failure = null;
  const el = id => {
    if (!detail && id === "machine-record") return null;
    if (!nodes.has(id)) nodes.set(id, {
      value: "", innerHTML: "", textContent: "", hidden: false, disabled: false, open: false,
      classList: { toggle() {} }, addEventListener(name, callback) { this[name] = callback; },
      showModal() { this.open = true; }, close() { this.open = false; }, reset() {},
    });
    return nodes.get(id);
  };
  const context = vm.createContext({
    console: { error() {} }, URL, URLSearchParams, Date,
    showSaveResult: async message => { calls.push({ modal: message }); },
    document: { getElementById: el },
    location: { search: detail ? "?machine=SL350" : "" },
    crypto: { randomUUID },
    FormData: class { append() {} },
    window: { addEventListener(name, callback) { listeners[name] = callback; }, open() { return null; } },
    confirm: () => true, verifyLocalAuth: async () => true, renderHeader() {},
    config: { api: "https://api.test" }, ensureToken: async () => "test-token",
    fetch: async (url, options) => {
      const body = options.body ? JSON.parse(options.body) : null;
      calls.push({ url, options, body });
      if (failure && (!failure.action || failure.action === body?.action)) {
        return { ok: false, status: failure.status || 409, json: async () => ({ message: failure.message }) };
      }
      if (body?.action === "save") {
        state = { ...state, revision: '"v2"', record: { ...state.record, entries: body.entries.map(entry => ({
          ...entry, updatedAt: "2026-11-05T10:00:00Z", updatedBy: "editor",
        })) } };
        return { ok: true, json: async () => ({ saved: true }) };
      }
      return { ok: true, json: async () => detail ? clone(state)
        : { machines: [{ id: "SL350", name: "Tractor" }, { id: "BSA650", name: "Sprayer" }], canEdit } };
    },
  });
  vm.runInContext(source, context);
  await listeners.DOMContentLoaded();
  return { context, el, calls, listeners, fail(value) { failure = value; }, state: () => state };
}

test("authenticated reads use existing master and no-store API, list searches by name and ID", async () => {
  const h = await harness({ detail: false });
  assert.equal(h.calls[0].url, "https://api.test/machines");
  assert.equal(h.calls[0].options.cache, "no-store");
  assert.equal(h.calls[0].options.headers.Authorization, "Bearer test-token");
  assert.match(h.el("machine-list").innerHTML, /detail.html\?machine=SL350/);
  h.el("machine-search").value = "bsa";
  h.el("machine-search").oninput();
  assert.doesNotMatch(h.el("machine-list").innerHTML, /Tractor/);
  assert.match(h.el("machine-list").innerHTML, /Sprayer/);
});

test("workers can read but no edit controls are displayed or usable", async () => {
  const h = await harness({ canEdit: false });
  assert.equal(h.el("machine-tools").hidden, true);
  h.el("machine-add").onclick();
  assert.equal(h.el("machine-editor").open, false);
  const count = h.calls.length;
  await h.context.saveEditor({ preventDefault() {} });
  assert.equal(h.calls.length, count);
});

test("freeform opening marks and notes are stored without a preset schema", async () => {
  const h = await harness();
  h.el("machine-add").onclick();
  h.el("entry-kind").value = "setting";
  h.el("entry-title").value = "ホッパーの開度目盛り";
  h.el("entry-body").value = "作業機A、目盛り3。資材が変わるときは実機で再確認。\n確認日：11/5";
  await h.el("machine-form").onsubmit({ preventDefault() {} });
  const save = h.calls.find(call => call.body?.action === "save");
  assert.equal(save.body.revision, null);
  assert.equal(save.body.machine, "SL350");
  assert.equal(save.body.entries[0].kind, "setting");
  assert.match(save.body.entries[0].body, /目盛り3/);
  assert.equal("memoryNo" in save.body.entries[0], false);
  assert.equal(h.el("machine-editor").open, false);
  assert.match(h.el("machine-record").innerHTML, /ホッパーの開度目盛り/);
  assert.equal(h.calls.at(-1).modal, "資料を保存しました。");
});

test("stale revision failure preserves editor text and never claims success", async () => {
  const h = await harness();
  h.el("machine-add").onclick();
  h.el("entry-title").value = "Opening";
  h.el("entry-body").value = "Keep this draft";
  h.fail({ action: "save", message: "別の更新があります" });
  await h.el("machine-form").onsubmit({ preventDefault() {} });
  assert.equal(h.el("machine-editor").open, true);
  assert.equal(h.el("entry-body").value, "Keep this draft");
  assert.match(h.el("entry-status").textContent, /別の更新|入力は残しています/);
  assert.equal(h.el("entry-save").disabled, false);
  assert.equal(h.calls.filter(call => call.body?.action === "save").length, 1);
  assert.match(h.calls.at(-1).modal, /入力は残しています/);
});

test("attachments upload then complete before saving the reference", async () => {
  const h = await harness();
  h.el("machine-add").onclick();
  h.el("entry-title").value = "Manual";
  const asset = randomUUID();
  const actions = [];
  h.context.fetch = async (url, options) => {
    if (url === "https://upload.test") { actions.push("s3"); return { ok: true }; }
    const body = options.body ? JSON.parse(options.body) : null;
    actions.push(body?.action || "get");
    let response;
    if (body?.action === "upload") response = { id: asset, upload: { url: "https://upload.test", fields: { key: "key" } } };
    else if (body?.action === "complete") response = { id: asset, name: "manual.pdf", type: "application/pdf", size: 15 };
    else if (body?.action === "save") {
      assert.deepEqual(body.entries[0].attachments, [asset]);
      response = { saved: true };
    } else response = clone(initial);
    return { ok: true, json: async () => response };
  };
  h.el("entry-files").onchange({ target: { files: [{ name: "manual.pdf", type: "application/pdf", size: 15 }], value: "x" } });
  await h.el("machine-form").onsubmit({ preventDefault() {} });
  assert.deepEqual(actions, ["upload", "s3", "complete", "save", "get"]);
});

test("upload failure does not submit a document or discard the selected file", async () => {
  const h = await harness();
  h.el("machine-add").onclick();
  h.el("entry-title").value = "Manual";
  h.el("entry-files").onchange({ target: { files: [{ name: "manual.pdf", type: "application/pdf", size: 15 }], value: "x" } });
  h.fail({ action: "upload", message: "Upload unavailable", status: 500 });
  await h.el("machine-form").onsubmit({ preventDefault() {} });
  assert.equal(h.calls.filter(call => call.body?.action === "save").length, 0);
  assert.match(h.el("entry-status").textContent, /Upload unavailable/);
  assert.match(h.el("entry-attachments").innerHTML, /manual.pdf/);
});

test("stored text and file names are escaped and unsafe links are not rendered", async () => {
  const asset = randomUUID();
  const entry = { id: randomUUID(), kind: "operation", title: "<img onerror=alert(1)>",
    body: "<script>alert(1)</script>", url: "javascript:alert(1)",
    attachments: [asset], updatedAt: "2026-11-05T00:00:00Z" };
  const h = await harness({ entries: [entry], assets: { [asset]: { name: "<svg>.png" } } });
  const html = h.el("machine-record").innerHTML;
  assert.doesNotMatch(html, /<script>|<img |<svg>|javascript:/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;svg&gt;.png/);
});

test("documents start collapsed to titles and searching still matches hidden body text", async () => {
  const entry = { id: randomUUID(), kind: "setting", title: "Hopper",
    body: "opening mark 3", url: "https://example.com/manual",
    attachments: [], updatedAt: "2026-11-05T00:00:00Z" };
  const h = await harness({ entries: [entry] });
  const html = h.el("machine-record").innerHTML;
  assert.match(html, /<details class="machine-entry"><summary>Hopper<\/summary>/);
  assert.doesNotMatch(html, /<details[^>]*\bopen\b/);
  assert.match(html, /<\/summary>[\s\S]*opening mark 3[\s\S]*data-edit=[\s\S]*<\/details>/);
  h.el("machine-search").value = "opening mark";
  h.el("machine-search").oninput();
  assert.match(h.el("machine-record").innerHTML, /<summary>Hopper<\/summary>/);
  h.el("machine-search").value = "no matching text";
  h.el("machine-search").oninput();
  assert.doesNotMatch(h.el("machine-record").innerHTML, /<summary>/);
});

test("file validation accepts exact boundaries and rejects oversize or executable content", async () => {
  const h = await harness();
  assert.doesNotThrow(() => h.context.checkFiles([{ name: "manual.pdf", type: "application/pdf", size: 20 * 1024 * 1024 }], 9));
  assert.throws(() => h.context.checkFiles([{ name: "manual.pdf", type: "application/pdf", size: 20 * 1024 * 1024 + 1 }], 0), /20MB/);
  assert.throws(() => h.context.checkFiles([{ name: "x.svg", type: "image/svg+xml", size: 20 }], 0), /PDF/);
  assert.throws(() => h.context.checkFiles([{ name: "x.png", type: "image/png", size: 20 }], 10), /10件/);
});

test("API errors and missing login are explicit", async () => {
  const h = await harness();
  h.fail({ message: "Denied", status: 403 });
  await assert.rejects(h.context.machineApi("file", { id: "x" }), /Denied/);
  h.context.ensureToken = async () => null;
  await assert.rejects(h.context.machineApi(null), /ログイン/);
  h.context.ensureToken = async () => "test-token";
  h.context.fetch = async () => ({ status: 502, json: async () => { throw new Error("html"); } });
  await assert.rejects(h.context.machineApi(null), /応答を確認できません/);
});

test("closing changed drafts requires confirmation and pending save prevents closure", async () => {
  const h = await harness();
  h.el("machine-add").onclick();
  h.el("entry-title").value = "Draft";
  h.el("entry-body").value = "Draft text";
  h.context.confirm = () => false;
  h.el("entry-cancel").onclick();
  assert.equal(h.el("machine-editor").open, true);
  let resolveSave;
  let started;
  const waiting = new Promise(resolve => { started = resolve; });
  h.context.fetch = async () => { started(); return new Promise(resolve => { resolveSave = resolve; }); };
  const saving = h.el("machine-form").onsubmit({ preventDefault() {} });
  await waiting;
  h.el("entry-cancel").onclick();
  assert.equal(h.el("machine-editor").open, true);
  assert.equal(h.el("entry-save").disabled, true);
  resolveSave({ ok: false, json: async () => ({ message: "Conflict" }) });
  await saving;
  assert.equal(h.el("entry-save").disabled, false);
});

test("menu and QR register a separate library without changing legacy one-work redirect", () => {
  const pages = JSON.parse(read("data/pages.json")).pages;
  const library = pages.find(page => page.id === "machine-library");
  assert.deepEqual(library.roles, ["worker", "family", "admin"]);
  assert.equal(library.openLog, false);
  assert.equal(pages.find(page => page.path === "/machines/detail.html").accessOnly, true);
  const qr = read("admin/machine-qr.html");
  assert.match(qr, /id: "machine-library-detail"/);
  assert.match(qr, /requireMachine: true/);
  const hub = read("machine-work-hub.html");
  assert.match(hub, /if \(workPages.length === 1\)/);
  assert.match(hub, /location.replace\(withMachine\(workPages\[0\].path, machineId\)\)/);
  assert.match(hub, /machine-library-link/);
  const home = read("index.html");
  assert.match(home, /const TOP_CATEGORY_ORDER = \[[\s\S]*?"機械・設備"[\s\S]*?\];/);
  assert.match(home, /"機械・設備": "説明書・操作メモ・目盛りや調整の控えを確認する"/);
  assert.match(home, /"機械・設備": "🔧"/);
});
