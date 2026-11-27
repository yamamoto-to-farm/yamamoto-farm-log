const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const source = readFileSync(join(__dirname, "..", "deploy", "photos", "photos.js"), "utf8")
  .replace(/^import .*;\r?\n/gm, "")
  .replace(/init\(\)\.catch\(report\);\s*$/, "");

function setup(canEdit = true) {
  const nodes = new Map();
  const requests = [];
  function createElement(tagName) {
    return {
      tagName, children: [], events: {},
      classList: { toggle() {} },
      setAttribute(name, value) { this[name] = value; },
      append(...children) { this.children.push(...children); },
      addEventListener(name, callback) { this.events[name] = callback; }
    };
  }
  function element(id) {
    if (!nodes.has(id)) nodes.set(id, {
      value: "", hidden: true, disabled: false, textContent: "",
      classList: { toggle() {} }, focus() {}, close() { this.open = false; },
      showModal() { this.open = true; }, querySelectorAll() { return []; },
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; }
    });
    return nodes.get(id);
  }
  const context = vm.createContext({
    document: { getElementById: element, createElement, querySelectorAll: () => [] },
    window: { currentRole: "admin" }, console: { error() {} },
    URLSearchParams, URL, Date, Set,
    location: { pathname: "/photos/index.html", search: "?from=2026-10-28&to=2026-11-27", hash: "" }, hasSession: () => true,
    config: { api: "https://api.test" }, ensureToken: async () => "test",
    clearSession() {},
    CATEGORY_LABEL: { growth: "栽培記録" },
    plantingText: () => "",
    plantingCandidates: async () => [],
    candidateLabel: candidate => candidate.variety,
    Option: function(text, value) { this.text = text; this.value = value; },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => ({ id: "photo" }) };
    }
  });
  vm.runInContext(source, context);
  vm.runInContext(`photos = [{id:"photo",field:"A",takenOn:"2026-10-26",note:"old",
    url:"https://image.test",canEdit:${canEdit}}]; current = 0;`, context);
  return { context, element, requests };
}

test("photo field links to the field detail while the image still opens the viewer", () => {
  const { context, element } = setup();
  vm.runInContext(`photos[0].field = "事業所(西・2)&A"; openViewer = index => { globalThis.opened = index; }; render();`, context);
  const card = element("gallery").children[0];
  const imageButton = card.children[0];
  const fieldLink = card.children[1].children[0].children[0];
  const url = new URL(fieldLink.href, "https://example.test");
  assert.equal(url.pathname, "/fields/index.html");
  assert.equal(url.searchParams.get("field"), "事業所(西・2)&A");
  assert.equal(url.searchParams.get("return"), "/photos/index.html?from=2026-10-28&to=2026-11-27");
  assert.equal(fieldLink.textContent, "事業所(西・2)&A");
  assert.equal(fieldLink.events.click, undefined);
  imageButton.events.click();
  assert.equal(context.opened, 0);
});

test("a photo without a field does not link to the field list", () => {
  const { context, element } = setup();
  vm.runInContext(`photos[0].field = ""; render();`, context);
  assert.equal(element("gallery").children[0].children[1].children[0].children.length, 0);
});

test("editing visibility follows server permission even for local admin", () => {
  const { context, element } = setup(false);
  vm.runInContext("openViewer(0); startEditing();", context);
  assert.equal(element("edit-photo").hidden, true);
  assert.equal(element("photo-edit-form").hidden, true);
});

test("opening editor keeps original values; navigation does not discard edits", async () => {
  const { context, element } = setup();
  vm.runInContext("startEditing();", context);
  assert.equal(element("edit-taken-on").value, "2026-10-26");
  assert.equal(element("edit-note").value, "old");
  assert.equal(element("photo-edit-form").hidden, false);
  await vm.runInContext("step(1)", context);
  assert.equal(vm.runInContext("current", context), 0);
});

test("save sends only editable values and refreshes the filtered list", async () => {
  const { context, element, requests } = setup();
  element("edit-taken-on").value = "2026-10-28";
  element("edit-note").value = "new memo";
  vm.runInContext("load = async () => { globalThis.refreshed = true; };", context);
  await vm.runInContext("saveEditing({preventDefault(){}})", context);
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    field: "A", id: "photo", takenOn: "2026-10-28", note: "new memo",
    category: "", plantingRef: "", variety: "", plantDate: ""
  });
  assert.equal(requests[0].url, "https://api.test/photos/edit");
  assert.equal(context.refreshed, true);
  assert.equal(element("photo-edit-form").hidden, true);
  assert.equal(vm.runInContext("editingBusy", context), false);
});

test("growth editing preserves the current planting and sends the selected metadata", async () => {
  const { context, element, requests } = setup();
  vm.runInContext(`Object.assign(photos[0], {
    category: "growth", plantingRef: "original", variety: "品種A", plantDate: "2026-10-01"
  }); startEditing();`, context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(element("edit-category").value, "growth");
  assert.equal(element("edit-planting").value, "original");
  assert.equal(element("edit-planting").children[1].value, "original");
  vm.runInContext("load = async () => {};", context);
  await vm.runInContext("saveEditing({preventDefault(){}})", context);
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    field: "A", id: "photo", takenOn: "2026-10-26", note: "old",
    category: "growth", plantingRef: "original", variety: "品種A", plantDate: "2026-10-01"
  });
});

test("failed save retains editor and explicitly reports error", async () => {
  const { context, element } = setup();
  element("photo-edit-form").hidden = false;
  context.fetch = async () => ({ ok: false, status: 403, json: async () => ({ message: "denied" }) });
  await vm.runInContext("saveEditing({preventDefault(){}})", context);
  assert.equal(element("photo-edit-form").hidden, false);
  assert.match(element("viewer-status").textContent, /403.*denied/);
  assert.equal(vm.runInContext("editingBusy", context), false);
});

test("list refresh failure after saving does not report save failure", async () => {
  const { context, element } = setup();
  vm.runInContext("load = async () => { throw new Error('offline'); };", context);
  await vm.runInContext("saveEditing({preventDefault(){}})", context);
  assert.match(element("status").textContent, /変更は保存されました/);
});
