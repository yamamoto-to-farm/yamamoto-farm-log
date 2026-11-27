const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const source = readFileSync(join(__dirname, "..", "deploy", "photos", "materials.js"), "utf8")
  .replace(/^import .*;\r?\n/gm, "")
  .replace(/^export /gm, "");

function setup(session = true) {
  const listeners = {};
  const requests = [];
  function node() {
    return {
      children: [], style: {}, isConnected: true,
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      setAttribute() {},
    };
  }
  const container = node();
  const context = vm.createContext({
    document: { createElement: node },
    window: {
      addEventListener(name, fn) { listeners[name] = fn; },
      removeEventListener(name) { delete listeners[name]; },
    },
    location: { pathname: "/fertilizer/index.html", search: "" },
    console: { error() {} },
    URLSearchParams, URL,
    config: { api: "https://api.test" }, hasSession: () => session,
    ensureToken: async () => "token", clearSession() {}, login() {},
    fetch: async url => {
      requests.push(new URL(url));
      return { ok: true, json: async () => ({ photos: [
        { id: "image", url: "https://image.test", representative: true }
      ] }) };
    },
    container,
  });
  vm.runInContext(source, context);
  return { context, container, requests, listeners };
}

test("selected images use each material's own type and ID", async () => {
  const { context, container, requests } = setup();
  await vm.runInContext(`mountSelectedMaterialPhotos(container, () => ["fert", "pest"], {
    fert: { id: "F001", materialType: "fertilizer" },
    pest: { id: "FG0001", materialType: "pesticide" }
  })`, context);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(requests.map(url => [url.searchParams.get("materialType"), url.searchParams.get("materialId")]),
    [["fertilizer", "F001"], ["pesticide", "FG0001"]]);
  assert.equal(container.children[1].children.length, 2);
});

test("without photo login input is not blocked or queried", async () => {
  const { context, container, requests } = setup(false);
  vm.runInContext(`mountSelectedMaterialPhotos(container, () => ["fert"], {
    fert: { id: "F001", materialType: "fertilizer" }
  })`, context);
  assert.match(container.children[0].textContent, /ログ入力はそのまま/);
  assert.equal(requests.length, 0);
});

test("unrelated filter changes reuse the selected material request", async () => {
  const { context, requests, listeners } = setup();
  vm.runInContext(`mountSelectedMaterialPhotos(container, () => ["fert"], {
    fert: { id: "F001", materialType: "fertilizer" }
  })`, context);
  await new Promise(resolve => setImmediate(resolve));
  await listeners["filter:apply"]();
  assert.equal(requests.length, 1);
});

test("photo API errors are visible without blocking log input", async () => {
  const { context, container } = setup();
  context.fetch = async () => { throw new Error("offline"); };
  vm.runInContext(`mountSelectedMaterialPhotos(container, () => ["fert"], {
    fert: { id: "F001", materialType: "fertilizer" }
  })`, context);
  await new Promise(resolve => setImmediate(resolve));
  assert.match(container.children[0].textContent, /取得できません.*ログ入力は続けられます/);
});

test("stale requests cannot show an unselected material", async () => {
  const { context, container, listeners } = setup();
  let resolve;
  context.fetch = () => new Promise(r => { resolve = r; });
  vm.runInContext(`let names = ["fert"]; mountSelectedMaterialPhotos(container, () => names, {
    fert: { id: "F001", materialType: "fertilizer" }
  });`, context);
  await new Promise(r => setImmediate(r));
  vm.runInContext("names = []", context);
  await listeners["filter:apply"]();
  resolve({ ok: true, json: async () => ({ photos: [{ url: "old", representative: true }] }) });
  await new Promise(r => setImmediate(r));
  assert.equal(container.children.length, 0);
});

test("deleting an image confirms version retention and refreshes the editor", async () => {
  const { context, container } = setup();
  const calls = [];
  let prompt;
  context.confirm = value => { prompt = value; return true; };
  context.fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => options.method === "POST"
      ? { id: "image" }
      : { photos: calls.length === 1 ? [{ id: "image", url: "image", representative: true }] : [] } };
  };
  vm.runInContext('mountMaterialEditor(container, "fertilizer", "F001")', context);
  await new Promise(resolve => setImmediate(resolve));
  const remove = container.children[2].children[0].children[0].children[2];
  await remove.onclick();
  assert.match(prompt, /過去のバージョン.*残ります/);
  assert.equal(new URL(calls[1].url).pathname, "/photos/delete");
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    materialType: "fertilizer", materialId: "F001", id: "image"
  });
  assert.match(container.children[1].textContent, /削除しました/);
  assert.equal(container.children[2].children[0].children.length, 0);
});

test("failed deletion remains retryable", async () => {
  const { context, container } = setup();
  context.confirm = () => true;
  context.fetch = async (url, options) => options.method === "POST"
    ? { ok: false, status: 503, json: async () => ({ message: "削除失敗" }) }
    : { ok: true, json: async () => ({ photos: [{ id: "image", url: "image" }] }) };
  vm.runInContext('mountMaterialEditor(container, "fertilizer", "F001")', context);
  await new Promise(resolve => setImmediate(resolve));
  const remove = container.children[2].children[0].children[0].children[2];
  await remove.onclick();
  assert.equal(remove.disabled, false);
  assert.match(container.children[1].textContent, /削除を再試行できます/);
});
