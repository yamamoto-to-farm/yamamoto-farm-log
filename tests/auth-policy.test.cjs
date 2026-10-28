const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

function source(path) {
  return readFileSync(join(__dirname, "..", "deploy", ...path), "utf8")
    .replace(/^import .*;\r?\n/gm, "")
    .replace(/\bexport /g, "");
}

function setup({ prefixes = [], issuedMinutes = 40, idleMinutes = 0, allowed = true } = {}) {
  const now = Date.now();
  const storage = new Map(Object.entries({
    human: "test-user", role: "admin", authVersion: "1",
    authIssuedAt: String(now - issuedMinutes * 60000),
    authExpiresAt: String(now + 8 * 3600000),
    authLastActiveAt: String(now - idleMinutes * 60000),
    authStepupAt: String(now - issuedMinutes * 60000)
  }));
  const audits = [];
  const context = vm.createContext({
    console, Date, Map, Set,
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key)
    },
    window: { addEventListener() {} },
    document: { addEventListener() {} },
    location: { pathname: "/admin/index.html", href: "https://example.test/admin/index.html" },
    setInterval() {},
    alert() {},
    loadJSON: async path => path.includes("auth-config")
      ? { sensitivePathPrefixes: prefixes }
      : { authVersion: 1 },
    fetch: async () => ({ json: async () => [{ name: "test-user", role: "admin" }] }),
    loadAccessPages: async () => [],
    getPageAccess: () => ({ allowed }),
    audit: (event, detail) => audits.push({ event, detail })
  });
  vm.runInContext(source(["common", "ui.js"]), context);
  vm.runInContext("appendSecurityAudit = async (event, detail) => audit(event, detail)", context);
  return { context, audits, storage };
}

test("admin access after 30 minutes follows the ordinary session policy", async () => {
  const { context, audits, storage } = setup();
  assert.equal(await vm.runInContext("verifyLocalAuth({ noRedirect: true })", context), true);
  assert.equal(storage.get("role"), "admin");
  assert.equal(audits.length, 0);
});

test("explicit sensitive paths still require reauthentication", async () => {
  const { context, audits } = setup({ prefixes: ["/admin/"] });
  assert.equal(await vm.runInContext("verifyLocalAuth({ noRedirect: true })", context), false);
  assert.equal(audits[0].event, "stepup-required");
});

test("disabling path reauthentication preserves expiry and idle limits", async () => {
  for (const options of [{ issuedMinutes: 481 }, { idleMinutes: 61 }]) {
    const { context, audits } = setup(options);
    assert.equal(await vm.runInContext("verifyLocalAuth({ noRedirect: true })", context), false);
    assert.equal(audits[0].event, "expired");
  }
});

test("disabling path reauthentication does not bypass page permissions", async () => {
  const { context } = setup({ allowed: false });
  assert.equal(await vm.runInContext("verifyLocalAuth({ noRedirect: true })", context), false);
});

test("missing and invalid path settings retain the existing safe default", () => {
  const { context } = setup();
  for (const input of ["undefined", "null", "'invalid'", "['invalid']"]) {
    assert.equal(vm.runInContext(`JSON.stringify(normalizePathPrefixes(${input}))`, context), '["/admin/"]');
  }
  assert.equal(vm.runInContext("JSON.stringify(normalizePathPrefixes([]))", context), "[]");
});

test("settings editor persists empty paths without restoring the admin prefix", async () => {
  const nodes = new Map(Object.entries({
    "auth-session-ttl": { value: "480" },
    "auth-heartbeat": { value: "5" },
    "auth-idle-timeout": { value: "60" },
    "auth-stepup": { value: "30" },
    "auth-sensitive-prefixes": { value: " \n " },
    "save-auth-config-btn": {}
  }));
  let saved;
  const context = vm.createContext({
    document: { getElementById: id => nodes.get(id) },
    saveJSON: async (path, data) => { saved = { path, data }; },
    showSaveModal() {}, completeSaveModal() {},
    nowJstIso: () => "test-date",
    container: { insertAdjacentHTML() {} }
  });
  vm.runInContext(source(["admin", "edit-json", "card-edit-auth-config.js"]), context);
  vm.runInContext("renderEditCard({ json: { sensitivePathPrefixes: [] }, container })", context);
  await nodes.get("save-auth-config-btn").onclick();
  assert.equal(saved.path, "data/auth-config.json");
  assert.equal(JSON.stringify(saved.data.sensitivePathPrefixes), "[]");
  assert.equal(saved.data.sessionTtlMs, 28800000);
  assert.equal(saved.data.idleTimeoutMs, 3600000);
});
