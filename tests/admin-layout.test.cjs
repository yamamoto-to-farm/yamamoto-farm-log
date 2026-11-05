const assert = require("node:assert/strict");
const { readFileSync, readdirSync } = require("node:fs");
const { join, relative } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const deploy = join(__dirname, "..", "deploy");
const read = file => readFileSync(join(deploy, ...file.split("/")), "utf8");
function htmlFiles(folder) {
  return readdirSync(folder, { withFileTypes: true }).flatMap(item => {
    const path = join(folder, item.name);
    return item.isDirectory() ? htmlFiles(path) : item.name.endsWith(".html") ? [path] : [];
  });
}

test("all admin pages opt into shared layout after their page-specific styles", () => {
  const files = htmlFiles(join(deploy, "admin"));
  assert.equal(files.length, 14);
  for (const file of files) {
    const html = readFileSync(file, "utf8");
    const name = relative(deploy, file);
    assert.match(html, /<body class="recent-page admin-page(?: admin-page--(?:csv|log))?">/, name);
    const shared = html.indexOf('/common/css/recent-pages.css?v=20261105-layout-1');
    const admin = html.indexOf('/common/css/admin-pages.css?v=20261105-admin-1');
    assert.ok(shared > html.lastIndexOf("</style>") && admin > shared, name);
    assert.ok(admin < html.indexOf("</head>"), name);
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    assert.equal(new Set(ids).size, ids.length, `${name}: duplicate IDs`);
  }
});

test("specialized table widths and print rules remain explicit", () => {
  const css = read("common/css/admin-pages.css");
  assert.match(css, /admin-page--csv \{ --page-width: 1800px/);
  assert.match(css, /admin-page--log \{ --page-width: 1600px/);
  assert.match(css, /admin-table-scroll \{[^}]*overflow-x: auto/);
  assert.match(css, /@media print/);
  assert.match(css, /\.manual table \{ display: table; min-width: 0;/);
  assert.match(css, /\.admin-page:has\(\.manual\) \.back-action-slot \{ display: none; \}/);
  assert.match(read("admin/manual/index.html"), /#header, .back-action-slot \{ display: none; \}/);
  assert.doesNotMatch(read("common/css/main.css"), /admin-pages/);
});

test("JSON editor hub uses responsive shared classes and preserves editor destinations", () => {
  let html;
  const context = vm.createContext({});
  const source = read("admin/edit-json/edit-json.js")
    .replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
  vm.runInContext(source, context);
  context.renderJsonList({ insertAdjacentHTML(position, value) { html = value; } });
  assert.match(html, /class="json-editor-section"/);
  assert.match(html, /class="json-editor-grid"/);
  assert.doesNotMatch(html, /\bstyle=/);
  for (const target of ["fields", "workers", "machines", "attachment-index", "auth-config"]) {
    assert.ok(html.includes(`?data=${target}'`), target);
  }
});

test("CSV actions and QR controls retain IDs inside their new operation cards", () => {
  const csv = read("admin/edit-csv/index.html");
  for (const id of ["loadCsvBtn", "saveCsvBtn", "restoreCsvBtn", "addRowBtn", "deleteRowBtn", "csvSearchBtn", "csvRowJumpBtn"]) {
    assert.match(csv, new RegExp(`<button id="${id}" class="(?:primary|secondary)-btn"`));
  }
  assert.match(csv, /class="card admin-toolbar"[\s\S]*id="csvRowJumpBtn"[\s\S]*<\/section>/);
  assert.match(read("admin/machine-qr.html"), /class="card" aria-label="QRコードの対象を選択">[\s\S]*id="generate-btn"[\s\S]*<\/section>/);
});
