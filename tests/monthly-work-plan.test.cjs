const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const read = file => readFileSync(join(__dirname, "..", "deploy", ...file.split("/")), "utf8");
const strip = source => source.replace(/^import[\s\S]*?;\r?\n/gm, "").replace(/^export /gm, "");
function setup() {
  const nodes = new Map(), writes = [];
  const el = id => {
    if (!nodes.has(id)) nodes.set(id, {
      value: "", textContent: "", innerHTML: "", disabled: false,
      validity: { badInput: false }, classList: { toggle() {} },
      querySelectorAll: () => [], close() { this.open = false; }, showModal() { this.open = true; },
    });
    return nodes.get(id);
  };
  const context = vm.createContext({
    console: { warn() {}, error() {} }, window: { addEventListener() {} }, URLSearchParams,
    document: { getElementById: el }, showSaveResult: async message => { context.result = message; },
    fetch: async (url, options) => {
      if (options?.method === "PUT") { writes.push(JSON.parse(options.body)); return { ok: true }; }
      if (options?.method === "POST") return { ok: true, json: async () => ({ url: "https://fixture.invalid" }) };
      return { ok: true, json: async () => ({ days: {}, memo: "" }) };
    },
  });
  vm.runInContext(strip(read("schedule/work-plan/work-plan.js")), context);
  vm.runInContext('ym="2026-12"; editingDate="2026-12-16"; loadReady=true; data={days:{},shipments:{}};', context);
  return { context, el, writes };
}
function workRow(date, type = "harvest") {
  return {
    dataset: { type, src: "original-import" },
    querySelector(selector) {
      return {
        ".wp-row-date": { value: date, checkValidity: () => true },
        ".wp-row-note": { value: "field A" },
        ".wp-task-custom": { value: "自由な作業" },
      }[selector];
    },
  };
}
test("shipment belongs to the selected date and never follows a moved harvest", async () => {
  const { context, el, writes } = setup();
  vm.runInContext('data.days["2026-12-16"]=[{type:"harvest",note:"old"}];', context);
  el("day-rows").querySelectorAll = () => [workRow("2026-12-15")];
  el("shipment-count").value = "12";
  context.applyDay();
  assert.equal(vm.runInContext('data.shipments["2026-12-16"]', context), 12);
  assert.equal(vm.runInContext('data.shipments["2026-12-15"]', context), undefined);
  assert.equal(vm.runInContext('data.days["2026-12-15"][0].src', context), "original-import");
  assert.match(el("calendar").innerHTML, /出荷 12基/);
  await context.save();
  assert.equal(writes[0].shipments["2026-12-16"], 12);
  assert.equal(writes[0].days["2026-12-15"][0].type, "harvest");
});
test("blank removes shipping only, zero is explicit, and invalid quantity preserves the draft", () => {
  const { context, el } = setup();
  vm.runInContext('data.shipments={"2026-12-16":10,"2026-12-20":8};', context);
  el("shipment-count").value = "1.5";
  context.applyDay();
  assert.equal(vm.runInContext('data.shipments["2026-12-16"]', context), 10);
  assert.match(el("day-error").textContent, /整数/);
  el("shipment-count").value = "-1";
  context.applyDay();
  assert.equal(vm.runInContext('data.shipments["2026-12-16"]', context), 10);
  el("shipment-count").value = "0";
  context.applyDay();
  assert.equal(vm.runInContext('data.shipments["2026-12-16"]', context), 0);
  el("shipment-count").value = "";
  context.applyDay();
  assert.equal(vm.runInContext('data.shipments["2026-12-16"]', context), undefined);
  assert.equal(vm.runInContext('data.shipments["2026-12-20"]', context), 8);
});
test("old month JSON gains an empty shipment map without losing entries and unknown fields", async () => {
  const { context, writes } = setup();
  context.fetch = async (url, options) => {
    if (options?.method) {
      if (options.method === "PUT") { writes.push(JSON.parse(options.body)); return { ok: true }; }
      return { ok: true, json: async () => ({ url: "https://fixture.invalid" }) };
    }
    return { ok: true, json: async () => ({
      days: { "2026-12-01": [{ type: "harvest", note: "old" }] }, memo: "existing", future: "keep",
    }) };
  };
  await context.load();
  await context.save();
  assert.deepEqual(writes[0].shipments, {});
  assert.equal(writes[0].future, "keep");
  assert.equal(writes[0].days["2026-12-01"][0].note, "old");
});
test("failed or malformed loads cannot overwrite the existing monthly plan", async () => {
  for (const response of [
    { ok: false, status: 403 },
    { ok: true, json: async () => ({ shipments: { "2026-12-32": 3 } }) },
    { ok: true, json: async () => ({ shipments: { "2026-12-01": "3" } }) },
  ]) {
    const { context, el, writes } = setup();
    context.fetch = async () => response;
    await context.load();
    await context.save();
    assert.equal(writes.length, 0);
    assert.equal(el("save").disabled, true);
    assert.match(el("status").textContent, /既存データ保護/);
  }
});
test("new month 404 is editable and rendering escapes custom task and notes", async () => {
  const { context, el } = setup();
  context.fetch = async () => ({ ok: false, status: 404 });
  await context.load();
  assert.equal(el("save").disabled, false);
  vm.runInContext('data.days={"2026-12-16":[{type:"other",task:"<img>",note:"<script>"}]};', context);
  context.render();
  assert.doesNotMatch(el("calendar").innerHTML, /<img>|<script>/);
  assert.match(el("calendar").innerHTML, /&lt;img&gt;/);
});
test("monthly editor reuses the daily task picker and shift calendar includes shipping quantities", () => {
  const source = read("schedule/work-plan/work-plan.js");
  assert.match(source, /import \{ openPlanTaskModal \} from "\/common\/work-plan-form.js/);
  assert.match(source, /onClose: \(\) => \{ element\("day-dialog"\).showModal\(\)/);
  assert.match(read("admin/shift/shift.js"), /workPlan\?\.shipments\?\.\[cell.date\]/);
  assert.match(read("schedule/work-plan/index.html"), /id="shipment-count" type="number" min="0" step="1"/);
});
test("every shared task choice maps to a stable monthly type", () => {
  const { context } = setup();
  vm.runInContext(strip(read("common/work-plan-form.js")), context);
  const missing = vm.runInContext('PLAN_TASK_GROUPS.flatMap(([, tasks]) => tasks).filter(task => task !== "その他（自由入力）" && !TASK_TYPES[task])', context);
  assert.equal(missing.length, 0);
});
test("old other entries remain editable, while newly chosen custom tasks require a name", () => {
  const { context, el } = setup();
  const row = workRow("2026-12-16", "other");
  row.querySelector = selector => ({
    ".wp-row-date": { value: "2026-12-16", checkValidity: () => true },
    ".wp-row-note": { value: "既存のメモ" },
    ".wp-task-custom": { value: "" },
  }[selector]);
  row.dataset.legacyOther = "true";
  el("day-rows").querySelectorAll = () => [row];
  context.applyDay();
  assert.equal(vm.runInContext('data.days["2026-12-16"][0].note', context), "既存のメモ");
  delete row.dataset.legacyOther;
  el("shipment-count").value = "99";
  context.applyDay();
  assert.match(el("day-error").textContent, /作業内容/);
  assert.equal(vm.runInContext('data.shipments["2026-12-16"]', context), undefined);
});
test("different custom task names remain separate calendar labels", () => {
  const { context, el } = setup();
  vm.runInContext('data.days={"2026-12-16":[{type:"other",task:"点検"},{type:"other",task:"清掃"}]};', context);
  context.render();
  assert.match(el("calendar").innerHTML, />点検<\/span>/);
  assert.match(el("calendar").innerHTML, />清掃<\/span>/);
});
test("shift calendar renders shipments and escaped custom names alongside legacy tasks", () => {
  const source = read("admin/shift/shift.js");
  const nodes = {};
  const context = vm.createContext({
    element: id => nodes[id] ||= {},
    personColorMap: () => new Map(), getBase: () => ({}),
    buildCalendar: () => [[{ date: "2026-12-16", day: 16, items: [] }]],
    plan: { month: "2026-12", staff: [], requests: {} }, calMode: "plan",
    workPlan: {
      days: { "2026-12-16": [{ type: "other", task: "<点検>", note: '"メモ"' }, { type: "harvest" }] },
      shipments: { "2026-12-16": 12 },
    },
  });
  vm.runInContext(
    source.slice(source.indexOf("const WORK_LABELS"), source.indexOf("function currentScenario")) +
    source.slice(source.indexOf("function renderCalendar("), source.indexOf("function renderPersons(")),
    context,
  );
  context.renderCalendar([]);
  assert.match(nodes.calendar.innerHTML, /出荷 12基/);
  assert.match(nodes.calendar.innerHTML, /&lt;点検&gt;/);
  assert.match(nodes.calendar.innerHTML, /収穫/);
  assert.doesNotMatch(nodes.calendar.innerHTML, /<点検>/);
});
