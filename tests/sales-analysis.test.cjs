const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const source = readFileSync(join(__dirname, "..", "deploy", "sales", "sales-logic.js"), "utf8")
  .replace(/^export /gm, "");
const context = vm.createContext({});
vm.runInContext(source, context);
const analyze = (...args) => context.analyzeSales(...args);
const report = (items, number = "12345678") => ({ date: "20261120", number, items });
const item = (date, quantity, amount, unitPrice = 50) =>
  ({ shippingDate: date, quantity, amount, unitPrice, product: "キャベツ 鉄コンテナ" });
const weight = (date, totalWeight, field, plantingRef) =>
  ({ shippingDate: date, totalWeight, field, plantingRef });

test("sales sums taxable-exclusive amounts and allocates a unique exact daily match", () => {
  const result = analyze([report([item("2026-11-08", 100, 5000)])], [
    weight("2026-11-08", 40, "畑A", "A1"), weight("2026-11-08", 60, "畑B", "B1"),
    weight("2026-11-09", 10, "畑A", "A1"),
  ], "2026-11-01", "2026-11-30");
  assert.equal(result.monthly[0].amount, 5000);
  assert.equal(result.rows[0].matchStatus, "照合済み");
  assert.equal(result.allocations.find(entry => entry.field === "畑A").amount, 2000);
  assert.equal(result.allocations.find(entry => entry.field === "畑B").amount, 3000);
  assert.deepEqual(Array.from(result.unmatchedShippingDates), ["2026-11-09"]);
});

test("ambiguous, incomplete or negative sales never produce an automatic allocation", () => {
  const results = [
    analyze([report([item("2026-11-08", 100, 5000), item("2026-11-08", 100, 5000)])],
      [weight("2026-11-08", 100, "畑A", "A")], "2026-11-01", "2026-11-30"),
    analyze([report([item("2026-11-08", 100, 5000)])],
      [weight("2026-11-08", 99, "畑A", "A")], "2026-11-01", "2026-11-30"),
    analyze([report([{ ...item("2026-11-08", 100, 5000), product: "別の出荷" }])],
      [weight("2026-11-08", 100, "畑A", "A")], "2026-11-01", "2026-11-30"),
  ];
  for (const result of results) {
    assert.equal(result.allocations.length, 0);
    assert.ok(result.rows.every(row => row.matchStatus === "要確認"));
  }
});

test("invalid dates, records and incomplete shipping logs are surfaced", () => {
  assert.throws(() => analyze([], [], "2026-02-30", "2026-11-30"));
  assert.throws(() => analyze([report([item("2026-11-08", NaN, 100)])], [], "2026-11-01", "2026-11-30"));
  assert.throws(() => analyze([report([item("2026-11-08", -100, -5000)])], [], "2026-11-01", "2026-11-30"));
  assert.throws(() => analyze([report([]), report([])], [], "2026-11-01", "2026-11-30"));
  assert.throws(() => analyze([], [weight("2026-11-08", "", "畑A", "A")], "2026-11-01", "2026-11-30"));
});
