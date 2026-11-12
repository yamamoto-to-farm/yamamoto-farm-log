const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const source = readFileSync(join(__dirname, "..", "deploy", "shipping", "shipping.js"), "utf8")
  .replace(/^import[\s\S]*?;\r?\n/gm, "")
  .replace(/^export /gm, "");

test("shipping confirmation includes the sum of entered weights", async () => {
  const confirmations = [];
  const context = vm.createContext({
    localStorage: { getItem: () => null },
    window: { currentHuman: "" },
    document: {
      getElementById: id => ({
        shippingDate: { value: "2026-11-13" },
        notes: { value: "" },
        weights: { value: "500 650\n600" }
      })[id]
    },
    getMachineParam: () => "machine1",
    confirmSaveBeforeSubmit: async request => {
      confirmations.push(request);
      return false;
    },
    alert: message => assert.fail(message)
  });

  vm.runInContext(source, context);
  vm.runInContext('checkedOrder = ["2026-11-13_ref1"]', context);
  await context.saveShipping();

  assert.ok(confirmations[0].lines.includes("重量合計: 1,750kg"));
});
