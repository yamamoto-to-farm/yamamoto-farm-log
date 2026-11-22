import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import lambdaChromium from "@sparticuz/chromium";
import { capture, latestReport, parseReports } from "./browser.mjs";
import { createHandler } from "./index.mjs";
import { parseSales } from "./sales-parser.mjs";

const claims = {
  token_use: "access",
  client_id: "mg1q2dnn576jln28m5sja6eaf",
  iss: "https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_OFiPcQjkC",
  sub: "test",
  scope: "openid",
  "cognito:groups": "[admin]",
};
const event = (c = claims) => ({
  routeKey: "POST /settlements/capture",
  requestContext: { authorizer: { jwt: { claims: c } } },
});

test("latest selection rejects ambiguous and malformed lists", () => {
  assert.deepEqual(latestReport(["fOpenReport('20261120','12345678');", "fOpenReport('20261119','12345679');"]), {
    date: "20261120", number: "12345678",
  });
  assert.throws(() => latestReport(["fOpenReport('20261120','12345678');", "fOpenReport('20261120','12345679');"]));
  assert.throws(() => latestReport(["fOpenReport('20261119','12345678');", "fOpenReport('20261120','12345679');"]));
  assert.throws(() => latestReport(["fOpenReport('20260230','12345678');"]));
  assert.throws(() => latestReport([]));
  assert.equal(parseReports(["fOpenReport('20261120','12345678');", "fOpenReport('20261120','12345679');"]).length, 2);
  assert.throws(() => parseReports(["fOpenReport('20261120','12345678');", "fOpenReport('20261120','12345678');"]));
});

test("sales parser validates arithmetic and totals instead of guessing at adjustments", () => {
  const document = {
    product: "キャベツ 鉄コンテナ",
    rows: [["2026/11/08", "", "", "2,000.00", "50.00", "100,000", ""]],
    totalQuantity: "2,000.00", totalAmount: "100,000", tax: "8,000",
  };
  const result = parseSales(document);
  assert.deepEqual(result.items[0], {
    shippingDate: "2026-11-08", quantity: 2000, unitPrice: 50, amount: 100000, product: "キャベツ 鉄コンテナ",
  });
  assert.equal(result.tax, 8000);
  assert.throws(() => parseSales({ ...document, totalAmount: "100,001" }));
  assert.throws(() => parseSales({ ...document, rows: [["2026/11/08", "", "", "2,000.00", "50.00", "-100,000", ""]] }));
  assert.throws(() => parseSales({ ...document, rows: [["2026/02/30", "", "", "2,000.00", "50.00", "100,000", ""]] }));
});

test("analysis routes enforce permissions and keep source PDF and records private and immutable", async () => {
  const objects = new Map();
  const s3 = { send: async command => {
    const input = command.input;
    if (command.constructor.name === "PutObjectCommand") {
      if (objects.has(input.Key)) throw { $metadata: { httpStatusCode: 412 } };
      assert.equal(input.IfNoneMatch, "*");
      objects.set(input.Key, input.Body);
      return {};
    }
    if (command.constructor.name === "ListObjectsV2Command") {
      return { Contents: [...objects.keys()].filter(key => key.startsWith(input.Prefix)).map(Key => ({ Key })) };
    }
    if (command.constructor.name === "GetObjectCommand") {
      return { Body: { transformToString: async () => String(objects.get(input.Key)) } };
    }
    throw new Error("unexpected S3 command");
  } };
  const secrets = { send: async () => ({ SecretString: '{"username":"dummy","password":"dummy"}' }) };
  const fn = createHandler({
    s3, secrets, bucket: "private", secretId: "secret",
    discoverReports: async () => ({ reports: [{ date: "20261120", number: "12345678" }], hasNext: false }),
    captureReport: async (_credentials, _browser, selected) => ({
      ...selected, pdf: Buffer.from("pdf"), analysis: { items: [], tax: 0 },
    }),
  });
  const call = (routeKey, body, c = claims) => fn({
    routeKey, body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: { authorizer: { jwt: { claims: c } } },
  });
  assert.equal((await call("GET /settlements/analyses", undefined, {})).statusCode, 401);
  assert.equal((await call("POST /settlements/discover", { year: "2026", page: 0 })).statusCode, 400);
  assert.equal(JSON.parse((await call("POST /settlements/discover", { year: "2026", page: 1 })).body).reports.length, 1);
  assert.equal((await call("POST /settlements/import", { date: "20261031", number: "12345678" })).statusCode, 400);
  assert.equal((await call("POST /settlements/import", { date: "20261131", number: "12345678" })).statusCode, 400);
  const selection = { date: "20261120", number: "12345678" };
  assert.equal(JSON.parse((await call("POST /settlements/import", selection)).body).status, "saved");
  assert.equal(JSON.parse((await call("POST /settlements/import", selection)).body).status, "already_saved");
  const records = JSON.parse((await call("GET /settlements/analyses")).body).reports;
  assert.equal(records.length, 1);
  assert.match(records[0].source, /^settlements\/analysis-sources\/[a-f0-9]{64}\.pdf$/);
  assert.equal(objects.size, 2);
});

test("API checks access, writes once and handles duplicate", async () => {
  let secretCalls = 0;
  const writes = [];
  const secrets = { send: async () => { secretCalls++; return { SecretString: '{"username":"dummy","password":"dummy"}' }; } };
  const s3 = { send: async (command) => { writes.push(command.input); } };
  const fn = createHandler({
    s3, secrets, bucket: "private", secretId: "secret",
    captureReport: async () => ({ date: "20261120", number: "12345678", pdf: Buffer.from("pdf"), pages: 1 }),
  });
  assert.equal((await fn(event({}))).statusCode, 401);
  assert.equal((await fn(event({ ...claims, "cognito:groups": "[worker]" }))).statusCode, 403);
  assert.equal(secretCalls, 0);
  assert.equal(JSON.parse((await fn(event())).body).status, "saved");
  assert.equal(writes[0].Key, "settlements/raw/20261120_12345678.pdf");
  assert.equal(writes[0].IfNoneMatch, "*");
  s3.send = async () => { throw { $metadata: { httpStatusCode: 412 } }; };
  assert.equal(JSON.parse((await fn(event())).body).status, "already_saved");
});

test("capture logs in, renders Japanese PDF and checks document identity", async () => {
  const launchBrowser = async () => chromium.launch({
    executablePath: process.platform === "win32"
      ? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
      : await lambdaChromium.executablePath(),
    args: process.platform === "win32" ? [] : lambdaChromium.args,
    headless: true,
  });
  let browser = await launchBrowser();
  let loginPosted = false;
  const mockBrowser = {
    async newContext() {
      const context = await browser.newContext();
      return new Proxy(context, {
        get(target, property) {
          if (property === "route") return async (...args) => {
            await target.route(...args);
            await target.route("**/*", async (route) => {
              const url = new URL(route.request().url());
              if (url.pathname.startsWith("/__capture_fonts__/")) return route.fallback();
              if (url.pathname === "/k/th/index.html") {
                return route.fulfill({ contentType: "text/html", body: `<form name="frmLogin" action="/kumex/netseeds" method="post"><input name="UAD"><input name="PASS" type="password"><input type="submit"></form>` });
              }
              if (url.pathname === "/kumex/netseeds") {
                loginPosted = route.request().postData().includes("UAD=dummy") && route.request().postData().includes("PASS=dummy");
                return route.fulfill({ contentType: "text/html", body: "ok" });
              }
              if (url.searchParams.get("hid") === "contentlist") {
                return route.fulfill({ contentType: "text/html; charset=utf-8", body: `<select name="year"><option value="2026" selected>2026</option></select><a onclick="fOpenReport('20261120','12345678');">通知書</a>` });
              }
              if (url.searchParams.get("hid") === "form") {
                return route.fulfill({ contentType: "text/html; charset=utf-8", body: `<body>
                  販売代金精算通知書 № 12345678
                  <table><tr><td>品 名</td><td>キャベツ 鉄コンテナ</td></tr></table>
                  <table><tr><th>出荷日</th><th>市場名</th><th>等階級・点数</th><th>数量</th><th>単価</th><th>金額</th><th>備考</th></tr>
                  <tr><td>2026/11/08</td><td></td><td></td><td>2,000.00</td><td>50.00</td><td>100,000</td><td></td></tr>
                  <tr><td colspan="3"><table><tr><td>総 合 計<br>消費税等</td><td>2,000.00<br></td></tr></table></td>
                  <td colspan="3">100,000<!--販売金額--><br>8,000<!--消費税--></td><td>軽減8％</td></tr></table>
                  </body>` });
              }
              throw new Error("Unexpected request");
            });
          };
          const value = target[property];
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  };
  try {
    const result = await capture({ username: "dummy", password: "dummy" }, mockBrowser);
    assert.equal(loginPosted, true);
    assert.equal(result.number, "12345678");
    assert.equal(result.pages, 1);
    await browser.close();
    browser = await launchBrowser();
    const analyzed = await capture({ username: "dummy", password: "dummy" }, mockBrowser,
      { date: "20261120", number: "12345678" });
    assert.equal(analyzed.analysis.items[0].amount, 100000);
    assert.equal(analyzed.analysis.tax, 8000);
  } finally {
    await browser.close();
  }
});
