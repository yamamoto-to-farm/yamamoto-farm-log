const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, readdirSync } = require("node:fs");
const { join } = require("node:path");
const vm = require("node:vm");
const root = join(__dirname, "..", "deploy");
const read = path => readFileSync(join(root, ...path.split("/")), "utf8");
function htmlFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? htmlFiles(join(dir, entry.name)) : entry.name.endsWith(".html") ? [join(dir, entry.name)] : []);
}
test("all admin and recent pages opt in to the same help module", () => {
  const files = htmlFiles(join(root, "admin")).concat([
    "diary/index.html", "machines/index.html", "machines/detail.html",
    "schedule/daily-plan/index.html", "schedule/work-plan/index.html", "finance/index.html",
  ].map(path => join(root, ...path.split("/"))));
  assert.equal(files.length, 20);
  for (const file of files) assert.match(readFileSync(file, "utf8"), /src="\/common\/help.js\?v=20261106-1"/, file);
});
test("dynamic diary and plan explanations are marked while warnings remain inline", () => {
  assert.match(read("diary/participation.js"), /data-help="各人の参加時間について"/);
  assert.match(read("schedule/daily-plan/daily-plan.js"), /data-help="作業全体と参加時間の扱い"/);
  assert.match(read("admin/message/message.js"), /data-help="連絡文の手修正について"/);
  assert.match(read("common/help.js"), /\[role="status"\].*\[role="alert"\].*\.warning/);
  assert.match(read("finance/index.html"), /data-help-keep/);
  assert.match(read("machines/detail.html"), /class="machine-caution"/);
  assert.match(read("schedule/work-plan/work-plan.js"), /class='wp-note' role='status'/);
});
test("print restores explanations and accessible native dialogs support nesting", () => {
  const css = read("common/css/help.css");
  assert.match(css, /@media print[\s\S]*\.help-source \{ display: block !important/);
  const js = read("common/help.js");
  assert.match(js, /aria-haspopup", "dialog"/);
  assert.match(js, /dialog.showModal\(\)/);
  assert.match(js, /trigger.isConnected.*trigger.focus\(\)/);
  assert.doesNotMatch(js, /innerHTML\s*=/);
});
test("help converts only opted-in prose, deduplicates, syncs hidden and removes orphan buttons", () => {
  const nodes = [];
  const make = () => ({
    isConnected: true, hidden: false, dataset: {}, textContent: "説明",
    classList: { add() {} }, closest: () => false, matches: () => false,
    setAttribute() {}, before(button) { this.button = button; },
    remove() { this.isConnected = false; }, appendChild() {},
  });
  const doc = {
    head: { appendChild() {} }, body: {},
    createElement: () => { const node = make(); nodes.push(node); return node; },
    querySelectorAll: () => [],
  };
  const context = vm.createContext({
    document: doc, MutationObserver: class { observe() {} },
  });
  vm.runInContext(read("common/help.js").replace(/^export /gm, ""), context);
  const source = make(), status = make();
  status.matches = () => true;
  const scope = { querySelectorAll: () => [source, status] };
  context.refreshHelp(scope);
  assert.ok(source.button);
  assert.equal(status.button, undefined);
  const button = source.button;
  context.refreshHelp(scope);
  assert.equal(source.button, button);
  source.hidden = true;
  context.refreshHelp(scope);
  assert.equal(button.hidden, true);
  source.isConnected = false;
  context.refreshHelp({ querySelectorAll: () => [] });
  assert.equal(button.isConnected, false);
});
