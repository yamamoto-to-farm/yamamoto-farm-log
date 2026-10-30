const assert = require("node:assert/strict");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const { test } = require("node:test");

const moduleUrl = pathToFileURL(join(__dirname, "..", "deploy", "admin", "shift", "shift-logic.js")).href;
const logic = () => import(moduleUrl);

const items = [
  { date: "2026-11-01", weekday: "日", person: "土井", raw_title: "希　〜15:00",
    request_hours: 6.5, proposed_hours: 6.5, proposed_end: "15:00",
    action: "確定（決まった曜日）", fixed_weekday: 1, reason: "" },
  { date: "2026-11-04", weekday: "水", person: "土井", raw_title: "希　終日",
    request_hours: 6.5, proposed_hours: 5.5, proposed_end: "14:00",
    action: "確定・短縮（決まった曜日）", fixed_weekday: 1, reason: "" },
  { date: "2026-11-07", weekday: "土", person: "若月", raw_title: "希 終日",
    request_hours: 6.5, proposed_hours: 6.5, proposed_end: "",
    action: "確定の目安（追加）", fixed_weekday: 0, reason: "" },
  { date: "2026-11-08", weekday: "日", person: "若月", raw_title: "希 終日",
    request_hours: 6.5, proposed_hours: 0, proposed_end: "",
    action: "保留・見送り候補（追加）", fixed_weekday: 0, reason: "週5日の上限のため保留" },
];

const plan = {
  month: "2026-11",
  default_budget_max: 380000,
  staff: [
    { name: "石原", target_days: 9, protected: true },
    { name: "土井", target_days: 12 },
  ],
  scenarios: [
    { budget_max: 370000, cost: 365000, per_person_days: {}, per_person_cost: {}, items: [] },
    { budget_max: 380000, cost: 369255,
      per_person_days: { 石原: 8, 土井: 19 },
      per_person_cost: { 石原: 50000, 土井: 100000 }, items },
  ],
};

test("scenarioBudgets と defaultScenarioIndex", async () => {
  const { scenarioBudgets, defaultScenarioIndex } = await logic();
  assert.deepEqual(scenarioBudgets(plan), [370000, 380000]);
  assert.equal(defaultScenarioIndex(plan), 1);
  assert.equal(defaultScenarioIndex({ ...plan, default_budget_max: 999 }), 1); // 見つからなければ最後
});

test("itemKind は確定/追加/保留を見分ける", async () => {
  const { itemKind } = await logic();
  assert.equal(itemKind(items[0]), "fixed");
  assert.equal(itemKind(items[1]), "fixed");
  assert.equal(itemKind(items[2]), "extra");
  assert.equal(itemKind(items[3]), "hold");
});

test("buildCalendar は月曜はじまりで正しい位置に配置する", async () => {
  const { buildCalendar } = await logic();
  const weeks = buildCalendar("2026-11", items);
  // 2026-11-01 は日曜 → 第1週は月〜土が null、日曜が1日
  assert.equal(weeks[0].filter((c) => c === null).length, 6);
  assert.equal(weeks[0][6].day, 1);
  assert.equal(weeks[0][6].weekday, "日");
  assert.equal(weeks[0][6].items.length, 1);
  assert.equal(weeks[0][6].items[0].person, "土井");
  // 11/30(月) まで6週
  assert.equal(weeks.length, 6);
  assert.equal(weeks[5][0].day, 30);
  // 11/4(水) は第2週の水曜列
  assert.equal(weeks[1][2].day, 4);
  assert.equal(weeks[1][2].items[0].proposed_hours, 5.5);
});

test("buildChecklist は操作グループと文言を作る", async () => {
  const { buildChecklist } = await logic();
  const groups = buildChecklist(plan.scenarios[1]);
  assert.equal(groups.fixed.length, 2);
  assert.equal(groups.extra.length, 1);
  assert.equal(groups.hold.length, 1);
  assert.match(groups.fixed[0].label, /「希」を外して確定/);
  assert.match(groups.fixed[1].label, /14:00 に短縮/);
  assert.match(groups.extra[0].label, /3日前までに確定/);
  assert.match(groups.hold[0].label, /週5日の上限のため保留/);
  assert.equal(groups.fixed[0].id, "2026-11-01:土井");
});

test("personRows は日数・目標・人件費をまとめる", async () => {
  const { personRows } = await logic();
  const rows = personRows(plan, plan.scenarios[1]);
  assert.deepEqual(rows[0], { name: "石原", days: 8, target: 9, cost: 50000, protected: true });
  assert.deepEqual(rows[1], { name: "土井", days: 19, target: 12, cost: 100000, protected: false });
});

test("formatYen は桁区切りを付ける", async () => {
  const { formatYen } = await logic();
  assert.equal(formatYen(369255), "369,255円");
});
