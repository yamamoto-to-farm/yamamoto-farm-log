const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const read = file => readFileSync(join(__dirname, "..", "deploy", file), "utf8");
function contextFor(file, dependencies = {}) {
  const context = vm.createContext({ console: { error() {}, warn() {} }, ...dependencies });
  const source = read(file).replace(/^import[\s\S]*?;\r?\n/gm, "").replace(/^export /gm, "");
  vm.runInContext(source, context);
  return context;
}
const httpError = status => Object.assign(new Error(`HTTP ${status}`), { status });

test("shared readers attach HTTP status without hiding network or JSON failures", async () => {
  for (const [file, command] of [["common/json.js", 'loadJSON("/data/test.json")'],
    ["common/csv.js", 'loadCSV("/logs/test/all.csv")']]) {
    for (const status of [404, 403, 500]) {
      const context = contextFor(file, {
        fetch: async () => ({ ok: false, status }),
      });
      await assert.rejects(vm.runInContext(command, context), error => error.status === status);
    }
    const context = contextFor(file, { fetch: async () => { throw new Error("offline"); } });
    await assert.rejects(vm.runInContext(command, context), /offline/);
  }
});

test("diary only caches true absence and successful objects, not HTTP or malformed data errors", async () => {
  let calls = 0;
  const context = contextFor("diary/loadDiary.js", {
    loadJSON: async () => { calls++; throw httpError(404); },
  });
  assert.equal(await vm.runInContext('loadDiaryByDate("2026-11-03")', context), null);
  assert.equal(await vm.runInContext('loadDiaryByDate("2026-11-03")', context), null);
  assert.equal(calls, 1);
  for (const error of [httpError(403), httpError(500), new Error("offline"), new SyntaxError("JSON")]) {
    vm.runInContext("clearDiaryCache()", context);
    context.loadJSON = async () => { throw error; };
    await assert.rejects(vm.runInContext('loadDiaryByDate("2026-11-03")', context));
    context.loadJSON = async () => ({ work: [], memo: "" });
    const recovered = await vm.runInContext('loadDiaryByDate("2026-11-03")', context);
    assert.equal(recovered.memo, "");
  }
  for (const invalid of [null, [], "invalid"]) {
    vm.runInContext("clearDiaryCache()", context);
    context.loadJSON = async () => invalid;
    await assert.rejects(vm.runInContext('loadDiaryByDate("2026-11-03")', context), /形式が不正/);
  }
});

test("shared diary state treats saved empty or memo-only diaries as saved, never as no work", async () => {
  const context = contextFor("diary/status.js");
  assert.equal(vm.runInContext('diaryState({work: [], memo: ""}, [])', context), "saved");
  assert.equal(vm.runInContext('diaryState({memo: "メモ"}, [])', context), "saved");
  assert.equal(vm.runInContext('diaryState(null, [{}])', context), "pending");
  assert.equal(vm.runInContext('diaryState(null, [])', context), "empty");
  context.loadDiaryByDate = async () => null;
  context.loadLogsByDate = async () => [{}];
  assert.equal((await vm.runInContext('loadDiaryStatus("2026-11-03")', context)).state, "pending");
  context.loadLogsByDate = async () => { throw httpError(500); };
  await assert.rejects(vm.runInContext('loadDiaryStatus("2026-11-03")', context));
});

test("work logs skip only missing CSVs and retry failed CSVs without caching absence", async () => {
  const context = contextFor("diary/work-summary.js", {
    fetch: async () => ({ ok: true, json: async () => [
      { folder: "test", dateColumn: "date", displayName: "作業", headerName: ["date"] },
    ] }),
    normalizeKeys: value => value,
    loadCSV: async () => { throw httpError(404); },
  });
  assert.equal((await vm.runInContext('loadLogsByDate("2026-11-03")', context)).length, 0);
  for (const error of [httpError(403), httpError(500), new Error("offline")]) {
    vm.runInContext("clearWorkSummaryCache()", context);
    context.loadCSV = async () => { throw error; };
    await assert.rejects(vm.runInContext('loadLogsByDate("2026-11-03")', context));
    context.loadCSV = async () => [{ date: "2026-11-03" }];
    assert.equal((await vm.runInContext('loadLogsByDate("2026-11-03")', context)).length, 1);
  }
});

test("work-list errors and invalid JSON do not become an empty successful status", async () => {
  for (const response of [
    { ok: false, status: 500 },
    { ok: true, json: async () => ({}) },
    { ok: true, json: async () => { throw new SyntaxError("JSON"); } },
  ]) {
    const context = contextFor("diary/work-summary.js", { fetch: async () => response });
    await assert.rejects(vm.runInContext('loadLogsByDate("2026-11-03")', context));
  }
});

test("top status keeps failures separate and monitors seven previous days plus today", async () => {
  const source = read("index.html").match(/    async function loadRecentDiaryStatus\(\) \{[\s\S]*?\n    \}/)[0];
  let call = 0;
  const context = vm.createContext({
    console: { error() {} },
    toYmd: date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
    loadDiaryStatus: async ymd => {
      const state = ["saved", "pending", "empty", "error", "saved", "empty", "pending", "empty"][call++];
      if (state === "error") throw new Error("offline");
      return { ymd, state, diary: state === "saved" ? {} : null };
    },
  });
  vm.runInContext(source, context);
  const result = await vm.runInContext("loadRecentDiaryStatus()", context);
  assert.equal(result.statuses.length, 8);
  assert.equal(result.monitoredEntries.length, 7);
  assert.equal(result.statuses.filter(day => day.state === "error").length, 1);
  assert.equal(result.monitoredEntries.filter(day => day.state === "pending").length, 2);
  assert.equal(result.latestEntry.state, "saved");
});

function screenContext() {
  const nodes = new Map();
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, {
      textContent: "", innerHTML: "", disabled: false, hidden: true, open: false, value: "",
    });
    return nodes.get(id);
  };
  const context = contextFor("diary/diary.js", {
    document: { getElementById: get },
    window: { addEventListener() {} },
    renderWeatherBox() {}, renderDayPhotos() {},
    loadTimestampRows: async () => [],
    loadDiaryStatus: async () => { throw new Error("offline"); },
    diaryStateLabels: { saved: "日誌保存済み", error: "取得できません" },
    clearDiaryStatusCache() {},
    initEditPage: async () => {},
    initViewPageWithOptions: async () => {},
    showWorkSummary: async () => {},
    initCollapse() {},
  });
  vm.runInContext(`
    renderModeSwitch = () => {};
    bindDiaryBackOriginButton = () => {};
  `, context);
  return { context, get };
}

test("diary fetch failure blocks editing and saving, and retry recovers the same date", async () => {
  const { context, get } = screenContext();
  context.saveBtn = get("saveDiaryBtn");
  await vm.runInContext('renderDiaryForDate({mode:"edit",date:"2026-11-03",saveBtn,updateHistory:false,clearSearch:false})', context);
  assert.equal(get("saveDiaryBtn").disabled, true);
  assert.match(get("diaryDataStatus").textContent, /取得できません.*判定していません/);
  assert.equal(get("retryDiaryData").hidden, false);
  assert.equal(vm.runInContext("isEditPageLoading", context), true);
  context.loadDiaryStatus = async date => ({ ymd: date, state: "saved", diary: {}, logs: [] });
  await get("retryDiaryData").onclick();
  assert.equal(get("diaryDataStatus").textContent, "日誌保存済み");
  assert.equal(get("retryDiaryData").hidden, true);
  assert.equal(get("saveDiaryBtn").disabled, false);
  assert.equal(vm.runInContext("isEditPageLoading", context), false);
});

test("a late failed request cannot replace a newer day's successful status", async () => {
  const { context, get } = screenContext();
  let rejectOld;
  context.loadDiaryStatus = date => date === "2026-11-02"
    ? new Promise((resolve, reject) => { rejectOld = reject; })
    : Promise.resolve({ ymd: date, state: "saved", diary: {}, logs: [] });
  const old = vm.runInContext('renderDiaryForDate({mode:"view",date:"2026-11-02",updateHistory:false,clearSearch:false})', context);
  await vm.runInContext('renderDiaryForDate({mode:"view",date:"2026-11-03",updateHistory:false,clearSearch:false})', context);
  rejectOld(new Error("offline"));
  await old;
  assert.equal(get("diaryDataStatus").textContent, "日誌保存済み");
  assert.equal(get("retryDiaryData").hidden, true);
});

test("saving never replaces an existing diary after read failure", async () => {
  const alerts = [];
  const context = contextFor("diary/saveDiary.js", {
    loadJSON: async () => { throw httpError(500); },
    saveJSON: async () => { throw new Error("must not save"); },
    alert: message => alerts.push(message),
  });
  assert.equal(await vm.runInContext('saveDiary("2026-11-03", [])', context), false);
  assert.match(alerts[0], /取得できないため保存を中止/);
});

test("saving reports success, cancellation and write failure explicitly", async () => {
  for (const outcome of ["success", "cancel", "failure"]) {
    let writes = 0;
    let cleared = 0;
    const alerts = [];
    const context = contextFor("diary/saveDiary.js", {
      loadJSON: async () => { throw httpError(404); },
      document: { getElementById: () => ({ value: "テストメモ" }) },
      confirmSaveBeforeSubmit: async () => outcome !== "cancel",
      showSaveModal() {},
      completeSaveModal() {},
      closeSaveModal() {},
      clearDiaryCache: () => { cleared++; },
      saveJSON: async (path, data) => {
        writes++;
        assert.equal(path, "data/diary/2026/2026-11-03.json");
        assert.equal(data.memo, "テストメモ");
        if (outcome === "failure") throw new Error("write failed");
      },
      alert: message => alerts.push(message),
    });
    assert.equal(await vm.runInContext('saveDiary("2026-11-03", [])', context), outcome === "success");
    assert.equal(writes, outcome === "cancel" ? 0 : 1);
    assert.equal(cleared, outcome === "success" ? 1 : 0);
    assert.equal(alerts.length, outcome === "failure" ? 1 : 0);
  }
});
