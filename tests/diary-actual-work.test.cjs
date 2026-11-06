const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const source = name => readFileSync(join(__dirname, "..", "deploy", "diary", name), "utf8")
  .replace(/^import.*\r?\n/gm, "").replace(/^export /gm, "");
function load(name, deps = {}) {
  const context = vm.createContext({ console: { error() {} }, URLSearchParams, structuredClone, ...deps });
  if (name === "viewCard.js") {
    vm.runInContext(readFileSync(join(__dirname, "..", "deploy", "common", "work-plan-time.js"), "utf8")
      .replace(/^export /gm, ""), context);
    vm.runInContext(source("participation.js"), context);
  }
  vm.runInContext(source(name), context);
  return context;
}
function fixture() {
  const raw = (folder, field, logIndex) => ({ folder, field, logIndex, sourceKey: `${folder}-${logIndex}`,
    date: "2026-11-04", workers: ["A"], machine: "JB13", sowingCategory: folder === "intertill" ? "爪カルチ" : "" });
  const auto = [raw("intertill", "圃場1", 0), raw("intertill", "圃場2", 1),
    raw("fertilizer", "圃場1", 2), raw("fertilizer", "圃場2", 3)];
  const group = (type, items) => ({ type, workers: "A", machine: "JB13", field: "圃場1／圃場2",
    start: "08:00", end: "13:44", items: items.map(item => ({ ...item })) });
  const groups = [group("中耕：爪カルチ", auto.slice(0, 2)), group("施肥", auto.slice(2))];
  const details = ["圃場1", "圃場2"].map(field => ({ date: "2026-11-04", field,
    workers: "A", machine: "JB13", sourceWork: "intertill", sourceWorkType: "爪カルチ",
    distributed: [{ field, name: "追肥S842", amount_kg: 70 }], notes: "降雨のため" }));
  return { auto, groups, details };
}
test("view-only grouping combines two-field simultaneous fertilizer, maps all raw logs to one card and never mutates records", () => {
  const { combineSimultaneousWork: combine } = load("actual-work.js");
  const { auto, groups, details } = fixture();
  const before = JSON.stringify({ auto, groups, details });
  const result = combine(groups, auto, details);
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].simultaneous.length, 2);
  assert.equal(result.groups[0].items.length, 2);
  assert.equal(result.groups[0].start, "08:00");
  assert.equal(result.groups[0].end, "13:44");
  assert.equal(result.references.length, 4);
  assert.ok(result.references.every(item => item.anchor === "actual-work-0"));
  assert.equal(JSON.stringify({ auto, groups, details }), before);
});
test("standalone work and ambiguous or mismatched simultaneous records retain separate cards", () => {
  const { combineSimultaneousWork: combine } = load("actual-work.js");
  const cases = [
    f => { f.details.forEach(entry => { delete entry.sourceWork; }); },
    f => { f.details[0].sourceWorkType = "別の作業"; },
    f => { f.details[0].workers = "B"; },
    f => { f.details[0].machine = "別の機械"; },
    f => { f.details[0].date = "2026-11-03"; },
    f => { f.details[0].field = "別圃場"; },
    f => { f.details.push({ ...f.details[0] }); },
    f => { f.auto.push({ ...f.auto[0], logIndex: 5 }); },
    f => { f.groups[1].end = "15:00"; },
    f => { f.groups[1].workers = "A／B"; },
    f => { f.groups[1].field = "補正した圃場"; },
    f => { f.groups[0].participation = { A: [{ start: "08:00", end: "12:00" }] }; },
    f => { f.auto.push({ ...f.auto[0], sourceKey: "another" }); f.groups.push({
      ...f.groups[0], items: [f.auto.at(-1)] }); },
  ];
  for (const change of cases) {
    const f = fixture();
    change(f);
    const result = combine(f.groups, f.auto, f.details);
    assert.equal(result.groups.length, f.groups.length, change.toString());
    assert.equal(result.groups[0].simultaneous.length, 0);
  }
  const f = fixture();
  assert.equal(combine(f.groups.slice(0, 1), f.auto, f.details).groups.length, 1);
  assert.equal(combine(f.groups.slice(1), f.auto, f.details).groups.length, 1);
});
test("linked and standalone groups coexist without hiding independent fertilizer", () => {
  const { combineSimultaneousWork: combine } = load("actual-work.js");
  const f = fixture();
  const extra = { ...f.auto[2], sourceKey: "standalone", field: "別圃場", logIndex: 4 };
  f.auto.push(extra);
  f.groups.push({ ...f.groups[1], field: "別圃場", items: [extra], start: "15:00", end: "16:00" });
  const result = combine(f.groups, f.auto, f.details);
  assert.equal(result.groups.length, 2);
  assert.equal(result.groups[1].type, "施肥");
  assert.equal(result.references[4].anchor, "actual-work-1");
});
test("bedmaking simultaneous fertilizer uses the same strict linkage without changing its work type", () => {
  const { combineSimultaneousWork: combine } = load("actual-work.js");
  const f = fixture();
  f.auto.filter(item => item.folder === "intertill").forEach(item => { item.folder = "bedmaking"; });
  f.details.forEach(entry => { entry.sourceWork = "bedmaking"; });
  f.groups[0].type = "畝立て";
  assert.equal(combine(f.groups, f.auto, f.details).groups[0].type, "畝立て");
  assert.equal(combine(f.groups, f.auto, f.details).groups.length, 1);
});
test("a CSV row summarizing multiple fields requires unique original entries for every field", async () => {
  const { combineSimultaneousWork: combine, loadFertilizerDetails } = load("actual-work.js", {
    safeFieldName: value => value, fetch: async url => ({ ok: true, json: async () => ({
      years: { "2026": { entries: [{ date: "2026-11-04" }] } },
    }) }),
  });
  const f = fixture();
  f.auto = [f.auto[0], { ...f.auto[2], logIndex: 1 }];
  f.auto.forEach(item => { item.field = "圃場1／圃場2"; });
  f.groups[0].items = [f.auto[0]];
  f.groups[1].items = [f.auto[1]];
  const result = combine(f.groups, f.auto, f.details);
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].simultaneous.length, 2);
  assert.equal(combine(f.groups, f.auto, f.details.slice(0, 1)).groups.length, 2);
  const loaded = await loadFertilizerDetails([{ folder: "fertilizer", data: { field: "圃場1／圃場2" } }], "2026-11-04");
  assert.equal(loaded.entries.length, 2);
});
test("missing raw source keys or only partial fertilizer matches never remove saved diary cards", () => {
  const { combineSimultaneousWork: combine } = load("actual-work.js");
  const f = fixture();
  assert.equal(combine(f.groups, f.auto, f.details.slice(0, 1)).groups.length, 2);
  f.groups[1].items[0].sourceKey = "saved-only";
  assert.equal(combine(f.groups, f.auto, f.details).groups.length, 2);
});
test("fertilizer reader uses per-field JSON, filters date, deduplicates requests and explicitly reports failures", async () => {
  const calls = [];
  const { details } = fixture();
  const context = load("actual-work.js", {
    safeFieldName: field => field,
    fetch: async (url, opts) => { calls.push({ url, opts }); return { ok: true, json: async () => ({
      years: { "2026": { entries: [details[0], { ...details[0], date: "2026-11-03" }] } },
    }) }; },
  });
  const logs = [{ folder: "fertilizer", data: { field: "圃場1" } }, { folder: "fertilizer", data: { field: "圃場1" } }];
  const result = await context.loadFertilizerDetails(logs, "2026-11-04");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.cache, "no-store");
  assert.match(calls[0].url, /^\/logs\/fertilizer\/.*\.json$/);
  assert.equal(result.entries.length, 1);
  assert.equal(result.errors.length, 0);
  for (const response of [
    { ok: false, status: 404 }, { ok: false, status: 403 }, { ok: false, status: 500 },
    { ok: true, json: async () => ({}) },
    { ok: true, json: async () => ({ years: { "2026": { entries: [null] } } }) },
  ]) {
    context.fetch = async () => response;
    const failed = await context.loadFertilizerDetails(logs, "2026-11-04");
    assert.equal(failed.entries.length, 0);
    assert.equal(failed.errors.length, 1);
  }
  context.fetch = async () => { throw new Error("offline"); };
  assert.match((await context.loadFertilizerDetails(logs, "2026-11-04")).errors[0], /offline/);
  context.fetch = () => assert.fail("non-fertilizer should not fetch");
  assert.equal((await context.loadFertilizerDetails([], "2026-11-04")).errors.length, 0);
});
function domNode(tag = "") {
  return { tag, children: [], className: "", dataset: {}, style: {}, textContent: "", innerHTML: "",
    appendChild(child) { this.children.push(child); return child; },
    setAttribute(name, value) { this[name] = value; }, classList: { add() {} } };
}
function find(node, predicate) {
  return [node, ...node.children.flatMap(child => find(child, predicate))].filter(predicate);
}
test("saved diary renders one combined card with expandable amounts and unchanged standalone cards, no data writes", async () => {
  const f = fixture();
  const actual = load("actual-work.js");
  const area = domNode();
  const context = load("viewCard.js", {
    combineSimultaneousWork: actual.combineSimultaneousWork,
    loadFertilizerDetails: async () => ({ entries: f.details, errors: [] }),
    extractWorkForEdit: () => f.auto, getWorkToneClass: () => "tone",
    document: { getElementById: id => id === "editWorkArea" ? area : { value: "2026-11-04" },
      createElement: domNode, createTextNode: text => ({ ...domNode(), textContent: text }),
      createDocumentFragment: () => area },
    location: { pathname: "/diary/index.html", search: "" },
  });
  // Use a separate fragment so our lightweight DOM does not append itself.
  context.document.createDocumentFragment = () => domNode("fragment");
  const diary = { work: f.groups, memo: "早上がり" };
  const before = JSON.stringify(diary);
  const references = await context.initViewPageWithOptions({ date: "2026-11-04", diary, logs: [], timestampRows: [] });
  assert.equal(references.length, 4);
  const cards = find(area, node => node.id === "actual-work-0");
  assert.equal(cards.length, 1);
  assert.ok(find(cards[0], node => node.textContent === "中耕：爪カルチ（同時施肥あり）").length);
  assert.equal(find(cards[0], node => node.className === "simultaneous-fertilizer").length, 1);
  assert.equal(find(cards[0], node => node.textContent === " 70 kg").length, 2);
  assert.equal(find(cards[0], node => node.textContent === "施肥記録を見る").length, 2);
  assert.ok(!find(cards[0], node => node.tag === "details").some(node => node.open));
  assert.equal(JSON.stringify(diary), before);
  const untouched = domNode();
  context.document.getElementById = id => id === "editWorkArea" ? untouched : { value: "2026-11-05" };
  await context.initViewPageWithOptions({ date: "2026-11-04", diary, logs: [], timestampRows: [], isCurrent: () => false });
  assert.equal(untouched.children.length, 0);
});
test("view reader failures keep both cards and explicitly announce the missing comparison", async () => {
  const f = fixture();
  const actual = load("actual-work.js");
  const area = domNode();
  const context = load("viewCard.js", {
    combineSimultaneousWork: actual.combineSimultaneousWork,
    loadFertilizerDetails: async () => ({ entries: [], errors: ["取得失敗"] }),
    extractWorkForEdit: () => f.auto, getWorkToneClass: () => "tone",
    document: { getElementById: id => id === "editWorkArea" ? area : { value: "2026-11-04" },
      createElement: domNode, createTextNode: text => ({ ...domNode(), textContent: text }),
      createDocumentFragment: () => domNode("fragment") },
    location: { pathname: "/diary/index.html", search: "" },
  });
  await context.initViewPageWithOptions({ date: "2026-11-04", diary: { work: f.groups }, logs: [], timestampRows: [] });
  assert.equal(find(area, node => node.id?.startsWith("actual-work-")).length, 2);
  assert.ok(find(area, node => node.role === "status" && node.textContent.includes("再試行")).length);
});
