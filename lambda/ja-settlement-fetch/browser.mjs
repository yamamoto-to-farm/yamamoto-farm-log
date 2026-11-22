import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { chromium as playwright } from "playwright-core";
import chromium from "@sparticuz/chromium";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const require = createRequire(import.meta.url);
const fontDirectory = path.dirname(require.resolve("@fontsource-variable/noto-sans-jp/package.json"));
const origin = "https://members.aichi-ja.or.jp";
const title = "販売代金精算通知書";

export function compact(text) {
  return text.normalize("NFKC").replace(/\s/g, "");
}

export function latestReport(rows) {
  if (!rows.length) throw new Error("通知書一覧に対象帳票がありません。");
  const parsed = rows.map((row) => {
    const match = /^fOpenReport\('(\d{8})','(\d{6,12})'\);?$/.exec(row.trim());
    if (!match) throw new Error("通知書一覧の形式が変わりました。");
    const [, date, number] = match;
    const parsedDate = new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T00:00:00Z`);
    if (Number.isNaN(parsedDate.valueOf()) || parsedDate.toISOString().slice(0, 10).replace(/-/g, "") !== date) {
      throw new Error("通知書の日付が不正です。");
    }
    return { date, number };
  });
  if (parsed.some((row, i) => i > 0 && row.date > parsed[i - 1].date)) {
    throw new Error("通知書が日付の新しい順ではありません。");
  }
  if (parsed.length > 1 && parsed[0].date === parsed[1].date) {
    throw new Error("最新日付の通知書が複数あるため、自動選択できません。");
  }
  return parsed[0];
}

export async function validatePdf(pdf, number) {
  if (pdf.length > 20 * 1024 * 1024) throw new Error("PDFが大きすぎます。");
  const document = await getDocument({ data: new Uint8Array(pdf), useSystemFonts: true }).promise;
  try {
    let text = "";
    for (let i = 1; i <= document.numPages; i++) {
      const content = await (await document.getPage(i)).getTextContent();
      text += content.items.map((item) => "str" in item ? item.str : "").join("");
    }
    const normalized = compact(text);
    if (!document.numPages || !normalized.includes(title) || !normalized.includes(number)) {
      throw new Error("PDFの帳票名または番号を確認できません。");
    }
    return document.numPages;
  } finally {
    await document.destroy();
  }
}

export async function capture(credentials, browserOverride) {
  const browser = browserOverride || await playwright.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true,
  });
  let context;
  try {
    context = await browser.newContext();
    let blocked = false;
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.protocol !== "https:" || url.hostname !== "members.aichi-ja.or.jp" || url.port) {
        blocked = true;
        await route.abort();
        return;
      }
      if (url.pathname.startsWith("/__capture_fonts__/")) {
        const name = url.pathname.slice("/__capture_fonts__/".length);
        if (!/^noto-sans-jp-[a-z0-9-]+\.woff2$/.test(name)) {
          throw new Error("フォント名が不正です。");
        }
        await route.fulfill({
          contentType: "font/woff2",
          body: await readFile(path.join(fontDirectory, "files", name)),
        });
        return;
      }
      await route.continue();
    });

    const page = await context.newPage();
    const login = await page.goto(`${origin}/k/th/index.html`, { waitUntil: "load" });
    if (!login?.ok()) throw new Error("JAログイン画面を取得できません。");
    await page.locator("form[name=frmLogin] input[name=UAD]").fill(credentials.username);
    await page.locator("form[name=frmLogin] input[name=PASS]").fill(credentials.password);
    await Promise.all([
      page.waitForNavigation({ waitUntil: "load" }),
      page.locator("form[name=frmLogin] input[type=submit]").click(),
    ]);

    const listing = await page.goto(`${origin}/kumex/report?hid=contentlist&id=HSB102`, { waitUntil: "load" });
    if (!listing?.ok()) throw new Error("通知書一覧を取得できません。");
    const years = await page.locator("select[name=year] option").evaluateAll((options) =>
      options.map((option) => option.value));
    if (!years.length || years.some((year) => !/^\d{4}$/.test(year))) {
      throw new Error("ログインまたは一覧の年を確認できません。");
    }
    const latestYear = years.toSorted().at(-1);
    if (await page.locator("select[name=year]").inputValue() !== latestYear) {
      await page.selectOption("select[name=year]", latestYear);
      await Promise.all([
        page.waitForNavigation({ waitUntil: "load" }),
        page.evaluate(() => fChangeYear()),
      ]);
    }
    const rows = await page.locator("a[onclick*='fOpenReport']").evaluateAll((links) =>
      links.map((link) => link.getAttribute("onclick")));
    const report = latestReport(rows);
    if (!report.date.startsWith(latestYear)) throw new Error("通知書の年が一致しません。");
    const reportUrl = `${origin}/kumex/report?hid=form&mod=HSB102&date=${report.date}&reportif=${report.number}`;
    const response = await page.goto(reportUrl, { waitUntil: "load" });
    if (!response?.ok() || !compact(await page.locator("body").innerText()).includes(title)) {
      throw new Error("通知書を取得できません。");
    }

    const css = (await readFile(path.join(fontDirectory, "index.css"), "utf8"))
      .replaceAll("./files/", `${origin}/__capture_fonts__/`);
    await page.addStyleTag({ content: `${css}\n* { font-family: 'Noto Sans JP Variable', sans-serif !important; }` });
    await page.emulateMedia({ media: "print" });
    await page.evaluate(() => document.fonts.ready);
    const pdf = await page.pdf({ format: "A4", printBackground: true });
    if (blocked) throw new Error("許可されていない外部リソースが要求されました。");
    const pages = await validatePdf(pdf, report.number);
    return { ...report, pages, pdf };
  } finally {
    try {
      if (context) await context.close();
    } finally {
      if (!browserOverride) await browser.close();
    }
  }
}
