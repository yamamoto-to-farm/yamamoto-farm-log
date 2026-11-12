const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const source = readFileSync(join(__dirname, "..", "deploy", "shipping", "shipping.js"), "utf8")
  .replace(/^import[\s\S]*?;\r?\n/gm, "")
  .replace(/^export /gm, "");

function harness(weights) {
  const confirmations = [];
  const alerts = [];
  const previewChildren = [];
  const elements = {
    shippingDate: { value: "2026-11-13" },
    notes: { value: "" },
    weights: { value: weights },
    shippingSummary: { textContent: "" },
    allocationPreview: {
      replaceChildren() { previewChildren.length = 0; },
      appendChild(child) { previewChildren.push(child); }
    },
    saveShippingButton: { disabled: true }
  };
  const context = vm.createContext({
    localStorage: { getItem: () => null },
    window: { currentHuman: "" },
    document: {
      getElementById: id => elements[id],
      createElement: tag => ({
        tag,
        textContent: "",
        children: [],
        appendChild(child) { this.children.push(child); }
      })
    },
    getMachineParam: () => "machine1",
    confirmSaveBeforeSubmit: async request => {
      confirmations.push(request);
      return false;
    },
    alert: message => alerts.push(message)
  });

  vm.runInContext(source, context);
  vm.runInContext(`
    unshippedByKey = new Map([
      ["2026-11-13_ref1", { key: "2026-11-13_ref1", field: "西七根", plantingRef: "ref1", remainBins: 3 }],
      ["2026-11-13_ref2", { key: "2026-11-13_ref2", field: "三角畑", plantingRef: "ref2", remainBins: 1 }]
    ]);
    checkedOrder = ["2026-11-13_ref1", "2026-11-13_ref2"];
  `, context);

  return { context, elements, previewChildren, confirmations, alerts };
}

test("live summary previews ordered weight allocation and save confirmation", async () => {
  const { context, elements, previewChildren, confirmations } = harness("400\n600");

  context.refreshShippingSummary();
  await context.saveShipping();

  assert.match(elements.shippingSummary.textContent, /選択：2件 \/ 4基/);
  assert.match(elements.shippingSummary.textContent, /今回の計量：4基 \/ 1,000kg/);
  assert.deepEqual(
    previewChildren[1].children.map(item => item.textContent),
    ["西七根 / ref1：3基・700kg", "三角畑 / ref2：1基・300kg"]
  );
  assert.ok(confirmations[0].lines.includes("重量合計: 1,000kg"));
  assert.ok(confirmations[0].lines.includes("割当 西七根 / ref1: 3基 / 700kg"));
  assert.equal(elements.saveShippingButton.disabled, false);
});

test("partial weight input warns which selected bins will not be recorded", () => {
  const { context, elements } = harness("500");

  context.refreshShippingSummary();

  assert.match(elements.shippingSummary.textContent, /未計量：2基/);
  assert.equal(elements.saveShippingButton.disabled, false);
});

test("invalid weight entries are visible and prevent saving", async () => {
  const { context, elements, confirmations, alerts } = harness("500 abc");

  context.refreshShippingSummary();
  await context.saveShipping();

  assert.match(elements.shippingSummary.textContent, /入力エラー：abc/);
  assert.equal(elements.saveShippingButton.disabled, true);
  assert.equal(confirmations.length, 0);
  assert.match(alerts[0], /無効な入力/);
});

test("excess weight entries are identified and prevent saving", async () => {
  const { context, elements, confirmations, alerts } = harness("100 200 300");

  context.refreshShippingSummary();
  await context.saveShipping();

  assert.match(elements.shippingSummary.textContent, /重量入力が1件多い/);
  assert.equal(elements.saveShippingButton.disabled, true);
  assert.equal(confirmations.length, 0);
  assert.match(alerts[0], /多すぎます/);
});
