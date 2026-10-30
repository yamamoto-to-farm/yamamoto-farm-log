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
  assert.equal(groups.skip.length, 0);
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

test("personColorMap は timetree の色に合わせる", async () => {
  const { personColorMap, FALLBACK_COLORS } = await logic();
  const colors = personColorMap([...plan.staff, { name: "松井" }]);
  assert.equal(colors.get("石原"), "#0d47a1"); // マリンブルー系
  assert.equal(colors.get("土井"), "#673ab7"); // すみれ色
  assert.equal(colors.get("松井"), FALLBACK_COLORS[0]); // 未定義はフォールバック
  assert.equal(colors.get("不明"), undefined);
});

test("workHours は正午またぎで休憩を変える", async () => {
  const { workHours } = await logic();
  const breaks = { not_spanning_noon: 10, spanning_noon: 60 };
  assert.equal(workHours("07:30", "15:00", breaks), 6.5); // またぐ→休憩60分
  assert.equal(workHours("8:20", "12:00", breaks), 3.5);  // またがない→休憩10分
  assert.equal(workHours("13:00", "17:10", breaks), 4);
  assert.equal(workHours("", "15:00", breaks), null);
  assert.equal(workHours("15:00", "10:00", breaks), null);
});

const calcPlan = {
  month: "2026-11",
  staff: [
    { name: "土井", target_days: 12, hourly: 1310 },
    { name: "若月", target_days: 12, hourly: 1260 },
  ],
  requests: { items: [{ date: "2026-11-01", person: "土井", start: "7:30", end: "15:00" }] },
  targets: {
    break_minutes: { not_spanning_noon: 10, spanning_noon: 60 },
    allday_default: { start: "06:00", end: "17:10" },
    commute: { per_day: 160, monthly_cap: 3000 },
    base_hourly: 1250, min_work_hours: 3.5, max_work_hours: 6.5,
  },
};

test("resolveShift は基本時間帯に収めて正午またぎを整理する", async () => {
  const { resolveShift } = await logic();
  const breaks = { not_spanning_noon: 10, spanning_noon: 60 };
  // 開始が基本時間帯より早い希望（〜15:00）→ 8:00開始に繰り下げて実働再計算
  assert.deepEqual(resolveShift("7:30", "15:00", 6.5, { start: "08:00", end: "16:30" }, breaks, 3.5),
    { start: "8:00", end: "15:00", hours: 6 });
  // 終了が基本時間帯を超える希望（希PM 13:00-17:10）→ 16:30終わりに
  assert.deepEqual(resolveShift("13:00", "17:10", 4, { start: "08:00", end: "16:30" }, breaks, 3.5),
    { start: "13:00", end: "16:30", hours: 3.33 });
  // 午後がわずかにまたぐ（7:30開始4.5h→13:00終了）→ 午前のみに寄せる
  assert.deepEqual(resolveShift("7:30", "", 4.5, { start: "06:00", end: "17:10" }, breaks, 3.5),
    { start: "7:30", end: "12:00", hours: 4.33 });
  // 午前がわずか（11:00開始）→ 午後のみに寄せ、実働は維持
  assert.deepEqual(resolveShift("11:00", "17:10", 4, { start: "06:00", end: "17:10" }, breaks, 3.5),
    { start: "13:00", end: "17:10", hours: 4 });
});

test("applyAdjustments は基本時間帯と個別編集を反映する", async () => {
  const { applyAdjustments } = await logic();
  const scenario = plan.scenarios[1];
  // 編集なし・基本時間帯が既定 → 7:30-15:00 のまま（またぎは午後2hなので維持）
  let eff = applyAdjustments(calcPlan, scenario, {}, { start: "06:00", end: "17:10" });
  assert.equal(eff[0].proposed_hours, 6.5);
  assert.equal(eff[0].status, "fixed");
  assert.equal(eff[0].start, "7:30"); // 原本から補完
  assert.equal(eff[0].edited, false);
  // 基本時間帯を 06:00-12:00 に → 7:30-12:00 に収まり実働4.33h
  eff = applyAdjustments(calcPlan, scenario, {}, { start: "06:00", end: "12:00" });
  assert.equal(eff[0].proposed_hours, 4.33);
  assert.equal(eff[0].proposed_end, "12:00");
  assert.equal(eff[1].proposed_hours, 5.5);   // 5.5hは枠内に収まる（6:00-11:40）
  assert.equal(eff[1].proposed_end, "11:40");
  assert.equal(eff[3].proposed_hours, 0); // 保留は0のまま
  // 個別編集：保留に変更（希のまま判断待ち）
  eff = applyAdjustments(calcPlan, scenario, { "2026-11-01:土井": { status: "hold" } }, null);
  assert.equal(eff[0].status, "hold");
  assert.equal(eff[0].proposed_hours, 0);
  assert.equal(eff[0].edited, true);
  // 個別編集：見送りに変更
  eff = applyAdjustments(calcPlan, scenario, { "2026-11-01:土井": { status: "skip" } }, null);
  assert.equal(eff[0].status, "skip");
  assert.equal(eff[0].proposed_hours, 0);
  assert.equal(eff[0].reason, "手動で見送りに変更");
  // 個別編集：時間変更（8:00-12:00 → 3.83h）はクリップされない
  eff = applyAdjustments(calcPlan, scenario,
    { "2026-11-01:土井": { status: "extra", start: "08:00", end: "12:00", hours: 3.83 } }, null);
  assert.equal(eff[0].status, "extra");
  assert.equal(eff[0].proposed_hours, 3.83);
  assert.equal(eff[0].proposed_end, "12:00");
});

test("computeCost は時給×実働＋交通費を再計算する", async () => {
  const { computeCost } = await logic();
  const eff = [
    { person: "土井", status: "fixed", proposed_hours: 6.5 },
    { person: "土井", status: "extra", proposed_hours: 6.5 },
    { person: "若月", status: "hold", proposed_hours: 0 }, // 見送りは除外
  ];
  const result = computeCost(eff, calcPlan);
  // 13h × 1310円 + 交通費 2日 × 160円 = 17,350円
  assert.equal(result.perPerson["土井"].cost, 17350);
  assert.equal(result.perPerson["土井"].days, 2);
  assert.equal(result.perPerson["若月"], undefined);
  assert.equal(result.total, 17350);
});

test("endTimeFor は実働から終了時刻を逆算する", async () => {
  const { endTimeFor } = await logic();
  const breaks = { not_spanning_noon: 10, spanning_noon: 60 };
  assert.equal(endTimeFor("7:30", 6.5, breaks), "15:00"); // 正午またぎ休憩60分
  assert.equal(endTimeFor("13:00", 4, breaks), "17:10");  // またがない休憩10分
  assert.equal(endTimeFor("", 6.5, breaks), "");
});

test("fitRemaining は編集済みを守って未編集だけ短縮する", async () => {
  const { fitRemaining, computeCost } = await logic();
  const eff = [
    { person: "土井", status: "fixed", proposed_hours: 6.5, edited: true, start: "7:30" },
    { person: "土井", status: "fixed", proposed_hours: 6.5, edited: false, start: "7:30" },
    { person: "若月", status: "extra", proposed_hours: 6.5, edited: false, start: "7:30" },
    { person: "若月", status: "hold", proposed_hours: 0, edited: false, start: "" },
  ];
  // 全部6.5hだと 25,700円。24,000円に収めるには未編集を6h上限に
  // （6h案は14:30終了＝午後90分またぎ→午前のみ7:30-12:00の4.33hに寄る）
  const result = fitRemaining(calcPlan, eff, 24000);
  assert.equal(result.over, false);
  assert.equal(result.capOthers, 6);
  assert.equal(result.items[0].proposed_hours, 6.5);  // 編集済みはそのまま
  assert.equal(result.items[0].autoCut, undefined);
  assert.equal(result.items[1].proposed_hours, 4.33); // 未編集は短縮＋午前のみに
  assert.equal(result.items[1].autoCut, true);
  assert.equal(result.items[1].proposed_end, "12:00");
  assert.equal(result.items[3].proposed_hours, 0);     // 保留はそのまま
  assert.ok(computeCost(result.items, calcPlan).total <= 24000);
  // 下限まで短くしても収まらない場合は over
  assert.equal(fitRemaining(calcPlan, eff, 1000).over, true);
});

test("shiftLabel は AM/PM/時間帯を出し分ける", async () => {
  const { shiftLabel } = await logic();
  assert.equal(shiftLabel("7:30", "12:00"), "AM");
  assert.equal(shiftLabel("13:00", "16:30"), "PM");
  assert.equal(shiftLabel("8:00", "16:30"), "8:00~16:30");
  assert.equal(shiftLabel("", "16:30"), "");
});

test("formatYen は桁区切りを付ける", async () => {
  const { formatYen } = await logic();
  assert.equal(formatYen(369255), "369,255円");
});
