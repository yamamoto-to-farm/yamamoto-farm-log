const assert = require("node:assert/strict");
const { readFileSync, existsSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const deploy = join(__dirname, "..", "deploy");
const read = path => readFileSync(join(deploy, path), "utf8");

test("unimplemented menu entries are marked unavailable and active destinations exist", () => {
  const pages = JSON.parse(read("data/pages.json")).pages;
  for (const id of ["nursery-log", "variety-analysis", "year-compare"]) {
    assert.equal(pages.find(page => page.id === id).disabled, true);
  }
  for (const page of pages.filter(page => !page.accessOnly && !page.disabled)) {
    const url = new URL(page.path, "https://farm.invalid/");
    assert.ok(existsSync(join(deploy, decodeURIComponent(url.pathname))), page.id);
  }
  const source = read("index.html").match(/    function createCard\(page\) \{[\s\S]*?\n    \}/)[0];
  const context = vm.createContext({
    document: { createElement: tag => ({
      tag, attributes: {}, children: [],
      setAttribute(key, value) { this.attributes[key] = value; },
      appendChild(child) { this.children.push(child); },
    }) },
  });
  vm.runInContext(source, context);
  const unavailable = vm.runInContext('createCard({name:"育苗ログ",path:"nursery/index.html",disabled:true})', context);
  assert.equal(unavailable.children[0].tag, "span");
  assert.equal(unavailable.children[0].attributes["aria-disabled"], "true");
  assert.equal(unavailable.children[0].textContent, "育苗ログ（準備中）");
  assert.equal(unavailable.children[0].href, undefined);
  const active = vm.runInContext('createCard({name:"写真一覧",path:"photos/index.html"})', context);
  assert.equal(active.children[0].tag, "a");
  assert.equal(active.children[0].href, "photos/index.html");
});

test("unimplemented fertilizer and pesticide plans have disabled buttons, not broken links", () => {
  for (const [type, name] of [["fertilizer", "施肥"], ["pesticide", "防除"]]) {
    const html = read(`${type}/index.html`);
    assert.ok(html.includes(`disabled>${name}計画（準備中）</button>`));
    assert.ok(!html.includes(`href="/${type}/schedule/schedule.html"`));
  }
});

test("KPI table retains all months, totals and drilldowns inside a keyboard-scrollable region", () => {
  const source = read("performance/kpi-render.js").replace(/^export /gm, "");
  const context = vm.createContext({});
  vm.runInContext(source, context);
  const html = vm.runInContext(`renderKpiTable(
    Array(12).fill(1), Array(12).fill(2), Array(12).fill(3),
    {kg:Array(12).fill(4),units:Array(12).fill(5)},
    {targetKg:Array(12).fill(6),targetUnits:Array(12).fill(7)},2026
  )`, context);
  assert.match(html, /class="kpi-table-scroll" tabindex="0" role="region" aria-label="2026年/);
  assert.equal((html.match(/<tr/g) || []).length, 14);
  assert.equal((html.match(/class="plan-cell"/g) || []).length, 12);
  assert.match(html, /year=2026&month=12/);
  assert.match(html, /<strong>合計<\/strong>/);
  assert.ok(html.endsWith("</tbody></table></div>"));
  const page = read("performance/harvest-kpi.html");
  assert.match(page, /\.kpi-table-scroll \{[^}]*overflow-x: auto/);
  assert.match(page, /@media print \{\s*\.kpi-table-scroll \{ overflow: visible/);
});
