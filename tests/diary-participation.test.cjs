const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const read = file => readFileSync(join(__dirname, "..", "deploy", ...file.split("/")), "utf8");
const strip = source => source.replace(/^import[\s\S]*?;\r?\n/gm, "").replace(/^export /gm, "");
function load(deps = {}) {
  const context = vm.createContext({ console: { error() {} }, structuredClone, URLSearchParams, ...deps });
  vm.runInContext(strip(read("common/work-plan-time.js")), context);
  const plans = vm.createContext({});
  vm.runInContext(strip(read("diary/planned-work.js")), plans);
  context.relatedPlanLogs = plans.relatedPlanLogs;
  const shared = vm.createContext({});
  vm.runInContext(strip(read("common/work-plan-form.js")), shared);
  context.resolveShiftWorker = shared.resolveShiftWorker;
  vm.runInContext(strip(read("diary/participation.js")), context);
  return context;
}
const work = () => ({
  type: "除草（手作業）：草取り", workers: ["家族A／パートB"], field: "圃場A",
  start: "08:00", end: "16:30", participation: {
    家族A: [{ start: "08:00", end: "12:00" }, { start: "13:00", end: "16:30" }],
    パートB: [{ start: "13:00", end: "16:30" }],
  },
});
const log = (folder, worker = "パートB", field = "圃場A") => ({
  folder, displayName: folder === "hand-weeding" ? "手作業除草" : "収穫",
  data: { worker, field, workType: "草取り" },
});
test("overall time copies to every person only after confirmation and reveals collapsed detail", () => {
  const alerts = [];
  let accepted = false, confirmations = 0;
  const detail = { open: false };
  const inputs = [{ value: "08:00" }, { value: "16:30" }];
  const people = ["家族A", "パートB"].map(name => ({
    dataset: { person: name }, rows: ["existing"],
    querySelector() { return { replaceChildren: (...rows) => { this.rows = rows; } }; },
  }));
  const card = {
    querySelectorAll: selector => selector === ".diary-person" ? people : inputs,
    querySelector: () => detail,
  };
  const c = load({
    alert: message => alerts.push(message),
    confirm: () => { confirmations++; return accepted; },
    document: { createElement: () => ({ querySelector: () => ({}) }) },
  });
  assert.equal(c.applyDiaryOverallTime(card), false);
  assert.deepEqual(people[0].rows, ["existing"]);
  assert.equal(detail.open, false);
  accepted = true;
  assert.equal(c.applyDiaryOverallTime(card), true);
  assert.equal(detail.open, true);
  for (const person of people) {
    assert.equal(person.rows.length, 1);
    assert.match(person.rows[0].innerHTML, /value="08:00"/);
    assert.match(person.rows[0].innerHTML, /value="16:30"/);
  }
  for (const range of [["", ""], ["08:00", ""], ["16:30", "08:00"]]) {
    [inputs[0].value, inputs[1].value] = range;
    assert.equal(c.applyDiaryOverallTime(card), false);
  }
  assert.equal(alerts.length, 3);
  assert.equal(confirmations, 2);
  assert.match(read("diary/participation.js"), /createElement\("details"\)/);
  assert.match(read("diary/participation.js"), /<summary>各人の作業時間（実績）<\/summary>/);
  assert.match(read("diary/editCard.js"), /target.closest\("input, button, textarea, select, option, a, summary"\)/);
});

test("one work stores different crews' ranges including breaks, and unknown is never full-day attendance", () => {
  const c = load();
  const item = work();
  c.validateDiaryTimes(item);
  item.participation.パートB = [];
  c.validateDiaryTimes(item);
  assert.equal(item.participation.パートB.length, 0);
  delete item.participation;
  c.validateDiaryTimes(item);
  assert.equal(Object.hasOwn(item, "participation"), false);
});
test("single worker follows overall input, preserves manual/saved times and never follows for multiple workers", () => {
  function setup(saved = [], workers = ["A"]) {
    const inputs = [{ value: "", listeners: {} }, { value: "", listeners: {} }];
    inputs.forEach(input => { input.addEventListener = (type, callback) => { input.listeners[type] = callback; }; });
    const area = { open: false, listeners: {}, addEventListener(type, callback) { this.listeners[type] = callback; } };
    const time = { after() {} };
    const person = { dataset: { person: "A" }, rows: ["untouched"],
      querySelector() { return { replaceChildren: (...rows) => { this.rows = rows; } }; } };
    const card = { querySelector: selector => selector === ".diary-participation" ? area : time,
      querySelectorAll: selector => selector === ".diary-person" ? [person] : inputs };
    const c = load({ document: { createElement: () => ({ setAttribute() {}, querySelector: () => ({}) }) } });
    c.bindSingleWorkerTime(card, { workers, participation: { A: saved } });
    const input = (start, end) => { inputs[0].value = start; inputs[1].value = end; inputs[1].listeners.input?.(); };
    return { c, card, area, person, input };
  }
  const auto = setup();
  auto.input("08:00", "");
  assert.deepEqual(auto.person.rows, ["untouched"]);
  auto.input("08:00", "16:30");
  assert.match(auto.person.rows[0].innerHTML, /value="08:00"/);
  assert.match(auto.person.rows[0].innerHTML, /value="16:30"/);
  assert.equal(auto.area.open, false);
  auto.input("09:00", "15:00");
  assert.match(auto.person.rows[0].innerHTML, /value="09:00"/);
  auto.input("", "");
  assert.equal(auto.person.rows.length, 0);
  auto.input("08:00", "16:30");
  auto.area.listeners.input({ target: { closest: () => true } });
  const before = auto.person.rows[0];
  auto.input("09:00", "15:00");
  assert.equal(auto.person.rows[0], before);
  const removed = setup();
  removed.area.listeners.click({ target: { closest: () => true } });
  removed.input("08:00", "16:30");
  assert.deepEqual(removed.person.rows, ["untouched"]);
  const saved = setup([{ start: "08:00", end: "12:00" }, { start: "13:00", end: "16:30" }]);
  saved.input("09:00", "17:00");
  assert.deepEqual(saved.person.rows, ["untouched"]);
  const multiple = setup([], ["A", "B"]);
  multiple.input("08:00", "16:30");
  assert.deepEqual(multiple.person.rows, ["untouched"]);
  const candidate = setup();
  candidate.c.card = candidate.card;
  vm.runInContext('applyCandidate(card, { A: [{ start: "13:00", end: "16:30" }] })', candidate.c);
  candidate.input("08:00", "17:00");
  assert.match(candidate.person.rows[0].innerHTML, /value="13:00"/);
});
test("invalid, overlapping, outside-work ranges and unrecognized names fail explicitly", () => {
  const c = load();
  for (const range of [
    { start: "16:30", end: "13:00" }, { start: "13:00", end: "" },
    { start: "07:00", end: "09:00" }, { start: "16:00", end: "17:00" },
    { start: "25:00", end: "26:00" },
  ]) {
    const item = work();
    item.participation.パートB = [range];
    assert.throws(() => c.validateDiaryTimes(item));
  }
  const item = work();
  item.participation.パートB.push({ start: "15:00", end: "16:00" });
  assert.throws(() => c.validateDiaryTimes(item), /重複/);
  const other = work();
  other.participation.別人 = [];
  assert.throws(() => c.validateDiaryTimes(other), /一致/);
});
test("cross-work overlaps warn by person, adjacent tasks and different people do not overlap", () => {
  const c = load();
  const first = work(), second = work();
  second.type = "収穫";
  assert.equal(c.diaryTimeOverlaps([first, second]).length, 2);
  first.participation = { パートB: [{ start: "13:00", end: "15:00" }] };
  second.participation = { パートB: [{ start: "15:00", end: "16:30" }] };
  assert.equal(c.diaryTimeOverlaps([first, second]).length, 0);
  second.participation = { 家族A: [{ start: "13:00", end: "16:30" }] };
  assert.equal(c.diaryTimeOverlaps([first, second]).length, 0);
});
test("plans match work, field and workers, with separate tasks and multiple possible plans never auto-selected", () => {
  const c = load();
  const plans = {
    one: { names: ["パートB"], off: false, blocks: [
      { task: "草とり", fields: ["圃場A"], start: "08:00", end: "15:00", companions: ["家族A"],
        participation: { パートB: [{ start: "13:00", end: "15:00" }] } },
      { task: "収穫", fields: ["圃場A"], start: "15:00", end: "16:30" },
    ] },
    two: { names: ["パートB"], off: false, blocks: [
      { task: "草とり", fields: ["圃場A"], start: "14:00", end: "15:00" },
    ] },
    off: { names: ["パートB"], off: true, blocks: [{ task: "草とり", start: "13:00", end: "16:30" }] },
  };
  const before = JSON.stringify(plans);
  const candidates = c.diaryPlanCandidates(work(), [log("hand-weeding"), log("hand-weeding", "家族A")], plans);
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].participation.パートB[0].start, "13:00");
  assert.equal(candidates[0].participation.家族A[0].start, "08:00");
  const harvest = c.diaryPlanCandidates(work(), [log("harvest")], plans);
  assert.equal(harvest.length, 1);
  assert.equal(harvest[0].participation.パートB[0].start, "15:00");
  assert.equal(c.diaryPlanCandidates(work(), [log("hand-weeding", "別人")], plans).length, 0);
  assert.equal(c.diaryPlanCandidates(work(), [log("hand-weeding", "パートB", "圃場B")], plans).length, 0);
  assert.equal(JSON.stringify(plans), before);
});
test("manual merge retains participant intervals rather than giving everyone overall hours", () => {
  const c = load();
  const first = work(), second = work();
  first.participation.パートB = [{ start: "13:00", end: "15:00" }];
  second.participation.パートB = [{ start: "15:00", end: "16:30" }];
  const result = c.mergeDiaryParticipation([first, second]);
  assert.equal(result.participation.パートB[0].start, "13:00");
  assert.equal(result.participation.パートB[0].end, "16:30");
  assert.equal(result.participation.家族A.length, 2);
  vm.runInContext(strip(read("diary/editCard.js")), c);
  c.createSessionKey = () => "merged-session";
  c.mergeGroups = [{ ...first, sourceKey: "a", items: [first] }, { ...second, sourceKey: "b", items: [second] }];
  assert.equal(vm.runInContext('buildManualMergedGroup(mergeGroups).participation["パートB"][0].start', c), "13:00");
  c.testWork = first;
  assert.equal(vm.runInContext('normalizeSavedGroup(testWork,0).participation["パートB"][0].start', c), "13:00");
  c.testGroup = { ...first, items: [{ ...first, sourceKey: "a" }, { ...second, sourceKey: "b" }] };
  assert.equal(vm.runInContext('expandMergedGroup(testGroup)[1].participation["パートB"][0].start', c), "15:00");
});
test("shift fallback reads edited proposals, maps login to display name, excludes noon break and errors explicitly", async () => {
  const responses = {
    "/shift/plan": { month: "2026-11", scenarios: [{}], staff: [{ name: "B", login: "worker-b" }],
      targets: { break_minutes: { spanning_noon: 60 } } },
    "/shift/edits": {}, "/shift/config": {},
  };
  const c = load({
    config: { api: "https://fixture.invalid" }, ensureToken: async () => "fixture",
    defaultScenarioIndex: () => 0, applyAdjustments: () => [
      { person: "B", date: "2026-11-06", start: "8:00", proposed_end: "16:30", proposed_hours: 7.5, status: "fixed" },
      { person: "B", date: "2026-11-06", start: "8:00", proposed_end: "16:30", proposed_hours: 7.5, status: "hold" },
    ], toInputTime: value => value.padStart(5, "0"),
    fetch: async url => ({ ok: true, json: async () => url.startsWith("/data/")
      ? [{ name: "worker-b", display: "パートB", role: "worker" }] : responses[new URL(url).pathname] }),
  });
  const shifts = await c.loadDiaryShiftTimes("2026-11-06");
  assert.deepEqual(JSON.parse(JSON.stringify(shifts.パートB)), [
    { start: "08:00", end: "12:00" }, { start: "13:00", end: "16:30" },
  ]);
  c.fetch = async () => ({ ok: false, status: 403 });
  await assert.rejects(() => c.loadDiaryShiftTimes("2026-11-06"), /403/);
});
test("save writes per-person actual times only to diary JSON and retains one work with multiple logs", async () => {
  const item = work();
  const card = {
    querySelectorAll: () => Object.entries(item.participation).map(([name, ranges]) => ({
      dataset: { person: name }, querySelectorAll: () => ranges.map(range => ({
        querySelectorAll: () => [{ value: range.start }, { value: range.end }],
      })),
    })),
  };
  let stored, path;
  const c = load({
    document: {
      querySelector: () => card,
      getElementById: id => ({ value: id.startsWith("start") ? "08:00" : id.startsWith("end") ? "16:30"
        : id.startsWith("field") ? "圃場A" : id === "freeMemo" ? "メモ" : "" }),
    },
    loadJSON: async () => ({ work: [], memo: "", future: "keep" }),
    confirmSaveBeforeSubmit: async () => true, showSaveModal() {}, completeSaveModal() {},
    clearDiaryCache() {}, closeSaveModal() {}, alert: message => assert.fail(message),
    saveJSON: async (key, data) => { path = key; stored = data; },
  });
  vm.runInContext(strip(read("diary/saveDiary.js")), c);
  assert.equal(await c.saveDiary("2026-11-06", [{ ...item, items: [{ sourceKey: "a" }, { sourceKey: "b" }] }]), true);
  assert.equal(path, "data/diary/2026/2026-11-06.json");
  assert.equal(stored.work.length, 1);
  assert.equal(stored.work[0].items.length, 2);
  assert.equal(stored.work[0].participation.パートB[0].start, "13:00");
  assert.equal(stored.future, "keep");
});
test("overlap cancellation never writes and incomplete input is explicitly rejected", async () => {
  let writes = 0, alerts = [], confirmations = [];
  const item = work();
  const card = {
    querySelectorAll: () => Object.entries(item.participation).map(([name, ranges]) => ({
      dataset: { person: name }, querySelectorAll: () => ranges.map(range => ({
        querySelectorAll: () => [{ value: range.start }, { value: range.end }],
      })),
    })),
  };
  const c = load({
    document: { querySelector: () => card, getElementById: id => ({
      value: id.startsWith("start") ? "08:00" : id.startsWith("end") ? "16:30" : "",
    }) },
    loadJSON: async () => ({ work: [] }), saveJSON: async () => writes++,
    confirmSaveBeforeSubmit: async request => { confirmations.push(request); return false; },
    alert: message => alerts.push(message),
  });
  vm.runInContext(strip(read("diary/saveDiary.js")), c);
  assert.equal(await c.saveDiary("2026-11-06", [item, { ...item, type: "収穫" }]), false);
  assert.equal(writes, 0);
  assert.match(confirmations[0].lines.join(" "), /重複/);
  item.participation.パートB[0].end = "";
  assert.equal(await c.saveDiary("2026-11-06", [item]), false);
  assert.match(alerts[0], /両方/);
  assert.equal(writes, 0);
});
