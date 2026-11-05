const assert = require("node:assert/strict");
const { readFileSync, existsSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const root = join(__dirname, "..", "deploy");
const read = file => readFileSync(join(root, ...file.split("/")), "utf8");
const pages = [
  "machines/index.html", "machines/detail.html", "schedule/daily-plan/index.html",
  "schedule/work-plan/index.html", "admin/message/index.html",
  "admin/shift/config.html", "finance/index.html",
];

test("recent screens opt into the same layout without changing global stylesheet imports", () => {
  for (const file of pages) {
    const html = read(file);
    assert.match(html, /<body class="recent-page(?: (?:recent-page--wide|admin-page))?">/, file);
    assert.match(html, /href="\/common\/css\/recent-pages.css\?v=20261105-layout-1"/, file);
    for (const [, href] of html.matchAll(/<link[^>]*href="([^"?]+)/g)) {
      const path = href.startsWith("/") ? join(root, ...href.slice(1).split("/"))
        : join(root, ...file.split("/").slice(0, -1), ...href.split("/"));
      assert.equal(existsSync(path), true, `${file}: ${href}`);
    }
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    assert.equal(new Set(ids).size, ids.length, `${file}: unique control IDs`);
  }
  assert.doesNotMatch(read("common/css/main.css"), /recent-pages/);
  assert.match(read("finance/index.html"), /recent-page--wide/);
  assert.match(read("common/css/recent-pages.css"), /\.recent-page \[hidden\] \{ display: none !important; \}/);
});

test("machine search is separate from results and has an accessible label", () => {
  for (const [file, results] of [["machines/index.html", "machine-list"], ["machines/detail.html", "machine-record"]]) {
    const html = read(file);
    assert.match(html, /<section class="card machine-search-card" aria-label="[^"]+">/);
    assert.match(html, /<label for="machine-search">/);
    assert.match(html, new RegExp(`<input id="machine-search"[^>]+>\\s*</section>\\s*<div id="${results}"`));
  }
});

test("daily date and shift toolbar is a separate card without moving save controls", () => {
  const html = read("schedule/daily-plan/index.html");
  assert.match(html, /<section class="card page-toolbar"[\s\S]*id="plan-date"[\s\S]*id="shift-state"[^>]*><\/p>\s*<\/section>/);
  assert.match(html, /<form id="plan-form">[\s\S]*type="submit"[\s\S]*<\/form>/);
});
