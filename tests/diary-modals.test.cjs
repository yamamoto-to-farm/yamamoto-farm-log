const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

function setup(file, module = false) {
  const nodes = new Map();
  function get(id) {
    if (!nodes.has(id)) nodes.set(id, {
      hidden: true, open: false, value: "2026-10-21", textContent: "",
      dataset: {}, attributes: {}, listeners: {},
      setAttribute(key, value) { this.attributes[key] = value; },
      addEventListener(key, callback) { this.listeners[key] = callback; },
      showModal() { this.open = true; }, close() { this.open = false; },
      replaceChildren() { this.textContent = ""; }
    });
    return nodes.get(id);
  }
  const context = vm.createContext({
    document: { getElementById: get }, window: { addEventListener() {} },
    location: { search: "" }, URLSearchParams, console, Date, Map, Set,
    loadDiaryIndexDates: async () => [],
    loadDiaryByDate: async () => null
  });
  let source = readFileSync(join(__dirname, "..", "deploy", "diary", file), "utf8")
    .replace(/^import .*;\r?\n/gm, "");
  if (module) source = source.replace(/\bexport /g, "");
  vm.runInContext(source, context);
  return { context, get };
}

test("date opens in dialog without an inline calendar and synchronizes expanded state", () => {
  const { context, get } = setup("diary.js");
  vm.runInContext("setDiaryMonthMiniOpen(true)", context);
  assert.equal(get("diaryDateDialog").open, true);
  assert.equal(get("diaryMonthMini").hidden, false);
  assert.equal(get("diaryDateDisplay").attributes["aria-expanded"], "true");
  vm.runInContext("setDiaryMonthMiniOpen(false)", context);
  assert.equal(get("diaryDateDialog").open, false);
  assert.equal(get("diaryMonthMini").hidden, true);
  assert.equal(get("diaryDateDisplay").attributes["aria-expanded"], "false");
});

test("changing diary date updates photo modal and gallery link without loading photos", async () => {
  const { context, get } = setup("day-photos.js", true);
  await vm.runInContext('renderDayPhotos("2026-10-21")', context);
  assert.equal(get("dayPhotosTitle").textContent, "2026/10/21 の写真");
  assert.equal(get("dayPhotosLink").href, "/photos/index.html?from=2026-10-21&to=2026-10-21");
  await vm.runInContext('renderDayPhotos("2026-10-22")', context);
  assert.match(get("dayPhotosLink").href, /from=2026-10-22&to=2026-10-22/);
});

test("photo close invalidates pending requests and removes signed images", () => {
  const { context, get } = setup("day-photos.js", true);
  vm.runInContext("initDayPhotosModal()", context);
  const body = get("dayPhotosBody");
  body.dataset.photoRequest = '{"date":"2026-10-21"}';
  body.textContent = "photos";
  get("dayPhotosDialog").listeners.close();
  assert.equal(body.dataset.photoRequest, "");
  assert.equal(body.textContent, "");
});

test("older calendar response cannot replace a newer month's calendar", async () => {
  const { context, get } = setup("diary.js");
  const waiting = {};
  context.defer = date => new Promise(resolve => { waiting[date] = resolve; });
  vm.runInContext("loadSavedDatesForMonth = defer; renderMonthMiniCalendar = date => document.getElementById('diaryMonthMini').textContent = date;", context);
  const first = vm.runInContext('refreshDiaryMonthMini("2026-10-21")', context);
  const second = vm.runInContext('refreshDiaryMonthMini("2026-11-21")', context);
  waiting["2026-11-21"]([]);
  await second;
  waiting["2026-10-21"]([]);
  await first;
  assert.equal(get("diaryMonthMini").textContent, "2026-11-21");
});
