import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import lambdaChromium from "@sparticuz/chromium";
import { capture, latestReport } from "./browser.mjs";
import { createHandler } from "./index.mjs";

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
  const browser = await chromium.launch({
    executablePath: process.platform === "win32"
      ? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
      : await lambdaChromium.executablePath(),
    args: process.platform === "win32" ? [] : lambdaChromium.args,
    headless: true,
  });
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
                return route.fulfill({ contentType: "text/html; charset=utf-8", body: "<body>販売代金精算通知書 № 12345678 2026/11/08 2,657 53 140,821</body>" });
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
  } finally {
    await browser.close();
  }
});
