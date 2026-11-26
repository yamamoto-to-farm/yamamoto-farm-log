const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const read = file => readFileSync(join(__dirname, "..", "deploy", file), "utf8");
function contextFor(file, dependencies = {}) {
  const context = vm.createContext({ console: { error() {}, warn() {} }, ...dependencies });
  if (file === "diary/saveDiary.js") {
    vm.runInContext(read("common/work-plan-time.js").replace(/^export /gm, ""), context);
    vm.runInContext(read("diary/participation.js").replace(/^import[\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""), context);
  }
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
  assert.equal(vm.runInContext("diaryStateLabels.pending", context), "作業記録あり");
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

test("top treats auto-displayed records as complete enough and collapses the date list", () => {
  const source = read("index.html").match(/    function renderDiaryCard\(status\) \{[\s\S]*?\n    \}/)[0];
  const card = { querySelectorAll: () => [], querySelector: () => null };
  const labels = contextFor("diary/status.js");
  const context = vm.createContext({
    document: { getElementById: () => card },
    diaryStateLabels: vm.runInContext("diaryStateLabels", labels),
    formatJapaneseYmd: date => date,
    formatShortDiaryDate: date => date,
  });
  vm.runInContext(source, context);
  context.status = {
    statuses: [{ ymd: "2026-11-03", state: "pending" }],
    monitoredEntries: [{ ymd: "2026-11-02", state: "pending" }],
    latestEntry: null,
  };
  vm.runInContext("renderDiaryCard(status)", context);
  assert.equal(card.className, "ops-card ops-card--ok");
  assert.match(card.innerHTML, /今日：作業記録あり/);
  assert.match(card.innerHTML, /過去7日：作業記録あり 1日/);
  assert.match(card.innerHTML, /<details[^>]*><summary>対象日を表示<\/summary>/);
  assert.doesNotMatch(card.innerHTML, /未確定|意味しません|data-diary-retry/);
  context.status.monitoredEntries.push({ ymd: "2026-11-01", state: "empty" });
  context.status.statuses.push({ ymd: "2026-11-01", state: "empty" }, { ymd: "2026-10-31", state: "error" });
  vm.runInContext("renderDiaryCard(status)", context);
  assert.equal(card.className, "ops-card ops-card--alert");
  assert.doesNotMatch(card.innerHTML, /意味しません/);
  assert.match(card.innerHTML, /data-diary-retry/);
  assert.doesNotMatch(card.innerHTML, /取得できなかった日は状態を判定していません/);
});

test("diary readers bypass cached shared readers lacking HTTP status metadata", () => {
  for (const file of ["diary/loadDiary.js", "diary/saveDiary.js"]) {
    assert.match(read(file), /from "\/common\/json\.js\?v=20261103-status-2"/);
  }
  assert.match(read("diary/work-summary.js"), /from "\/common\/csv\.js\?v=20261103-status-2"/);
  for (const file of ["diary/status.js", "diary/diary.js", "diary/editCard.js", "diary/viewCard.js", "diary/saveDiary.js"]) {
    assert.match(read(file), /from "\.\/loadDiary\.js\?v=20261103-status-2"/);
  }
  assert.match(read("diary/viewCard.js"), /補足がある場合だけ編集・保存/);
  assert.doesNotMatch(read("diary/viewCard.js"), /保存済み日誌はありません/);
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
    renderWeatherBox() {}, renderDayPhotos() {}, renderPlannedWork() {},
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

test("mode switch keeps the same live status chip before view buttons on every render", () => {
  const chip = { textContent: "日誌保存済み" };
  const inserted = [];
  const area = { innerHTML: "", querySelector: () => ({ prepend: node => inserted.push(node) }) };
  const context = contextFor("diary/diary.js", {
    document: { getElementById: id => id === "diaryDataStatus" ? chip
      : id === "modeSwitchArea" ? area : { value: "2026-11-04" } },
    window: { addEventListener() {}, currentRole: "admin" }, URLSearchParams,
    location: { search: "" },
  });
  vm.runInContext('buildDiaryUrl=(mode,date)=>`?mode=${mode}&date=${date}`;renderModeSwitch("view");renderModeSwitch("edit");', context);
  assert.equal(inserted.length, 2);
  assert.ok(inserted.every(node => node === chip));
  assert.equal(chip.textContent, "日誌保存済み");
  assert.match(area.innerHTML, /mode-switch-right/);
  const html = read("diary/index.html");
  assert.match(html, /id="diaryDataStatus" class="diary-status-chip print-hide" role="status"/);
  assert.match(html, /id="diaryDataError"[^>]+hidden/);
});
test("diary fetch failure blocks editing and saving, and retry recovers the same date", async () => {
  const { context, get } = screenContext();
  context.saveBtn = get("saveDiaryBtn");
  await vm.runInContext('renderDiaryForDate({mode:"edit",date:"2026-11-03",saveBtn,updateHistory:false,clearSearch:false})', context);
  assert.equal(get("saveDiaryBtn").disabled, true);
  assert.equal(get("diaryDataStatus").textContent, "取得できません");
  assert.match(get("diaryDataErrorText").textContent, /取得できません.*判定していません/);
  assert.equal(get("diaryDataError").hidden, false);
  assert.equal(get("retryDiaryData").hidden, false);
  assert.equal(vm.runInContext("isEditPageLoading", context), true);
  context.loadDiaryStatus = async date => ({ ymd: date, state: "saved", diary: {}, logs: [] });
  await get("retryDiaryData").onclick();
  assert.equal(get("diaryDataStatus").textContent, "日誌保存済み");
  assert.equal(get("diaryDataError").hidden, true);
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
