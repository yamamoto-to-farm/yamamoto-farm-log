import { verifyLocalAuth } from "/common/ui.js";
import { renderHeader } from "/common/header.js?v=1.1";
import { loadCSV } from "/common/csv.js?v=20260820";
import { todayLocalYmd } from "/common/date-utils.js?v=1";
import { clearSession, ensureToken, hasSession, login } from "/photos/auth.js?v=20261029-2";
import { analyzeSales } from "./sales-logic.js?v=20261123-1";

const apiBase = "https://8ifv43nb7l.execute-api.ap-northeast-1.amazonaws.com/settlements";
const startDate = "2026-11-01";
const el = id => document.getElementById(id);
let reports = [], weights = [], busy = false, loaded = false, nextRequestAt = 0;

function status(message, error = false) {
  el("status").textContent = message;
  el("status").classList.toggle("error", error);
}

async function api(path, body) {
  const token = await ensureToken();
  if (!token) {
    el("login-area").hidden = false;
    el("data-area").hidden = true;
    throw new Error("ログインの期限が切れました。再ログインしてください。");
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const delay = Math.max(0, nextRequestAt - Date.now());
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    nextRequestAt = Date.now() + 10500;
    const result = await fetch(`${apiBase}${path}`, {
      method: body === undefined ? "GET" : "POST", cache: "no-store",
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (result.status === 429 && attempt < 2) continue;
    if (result.status === 401 || result.status === 403) {
      if (result.status === 401) clearSession();
      el("login-area").hidden = false;
      el("data-area").hidden = true;
      throw new Error(result.status === 401 ? "再ログインしてください。" : "売上分析はCognitoのadmin / familyのみ利用できます。");
    }
    if (!result.ok) {
      let detail = "";
      const text = await result.text();
      try {
        const value = JSON.parse(text);
        if (typeof value.message === "string") detail = ` ${value.message}`;
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }
      throw new Error(`売上APIの処理に失敗しました（${result.status}）。${detail}`);
    }
    return result.json();
  }
  throw new Error("APIの利用制限に達しました。しばらく待ってから再実行してください。");
}

function addRow(id, values) {
  const row = document.createElement("tr");
  for (const value of values) {
    const cell = document.createElement("td");
    cell.textContent = value;
    row.appendChild(cell);
  }
  el(id).appendChild(row);
}

const format = value => new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 }).format(value);

function render() {
  for (const id of ["monthly", "allocations", "items"]) el(id).replaceChildren();
  el("summary").textContent = "";
  el("matching").textContent = "";
  if (el("from").value < startDate) throw new Error("開始日は2026年11月1日以降にしてください。");
  const result = analyzeSales(reports, weights, el("from").value, el("to").value);
  const total = result.rows.reduce((sum, item) => sum + item.amount, 0);
  el("summary").textContent = `取り込み済み ${result.rows.length}明細 / 税抜販売額 ${format(total)}円`;
  el("matching").textContent = `要確認 ${result.rows.filter(item => item.matchStatus !== "照合済み").length}明細 / 対応する精算明細がない出荷日 ${result.unmatchedShippingDates.length}日${result.unmatchedShippingDates.length ? `（${result.unmatchedShippingDates.join("、")}）` : ""}`;
  for (const row of result.monthly) addRow("monthly", [row.month, row.product, format(row.quantity), `${format(row.amount)}円`]);
  for (const row of result.allocations) addRow("allocations", [row.field, row.plantingRef, `${format(row.weight)}kg`, `${format(row.amount)}円`]);
  for (const row of result.rows.sort((a, b) => b.shippingDate.localeCompare(a.shippingDate))) {
    addRow("items", [row.shippingDate, row.product, format(row.quantity), `${format(row.unitPrice)}円`,
      `${format(row.amount)}円`, row.matchStatus, `${row.reportDate} / ${row.reportNumber}`]);
  }
}

async function refresh() {
  const [data, shipping] = await Promise.all([api("/analyses"), loadCSV("/logs/weight/all.csv")]);
  if (!Array.isArray(data.reports) || !Array.isArray(shipping)) throw new Error("売上または出荷記録の形式が不正です。");
  reports = data.reports;
  weights = shipping;
  render();
  loaded = true;
  el("data-area").hidden = false;
}

async function sync() {
  const saved = new Set(reports.map(report => `${report.date}_${report.number}`));
  const seen = new Set();
  let added = 0, skipped = 0;
  try {
    const currentYear = Number(todayLocalYmd().slice(0, 4));
    for (let year = 2026; year <= currentYear; year++) {
      let page = 1, lastDate = "99999999";
      while (true) {
        status(`JAの${year}年一覧（${page}ページ）を確認中。取得 ${added}件、保存済み ${skipped}件`);
        const listing = await api("/discover", { year: String(year), page });
        if (!Array.isArray(listing.reports) || typeof listing.hasNext !== "boolean") {
          throw new Error("通知書一覧の形式が不正です。");
        }
        let older = false;
        for (const report of listing.reports) {
          if (!/^\d{8}$/.test(report.date) || !/^\d{6,12}$/.test(report.number) ||
              !report.date.startsWith(String(year)) || report.date > lastDate) {
            throw new Error("通知書一覧の日付・順序が不正です。");
          }
          lastDate = report.date;
          if (report.date < "20261101") { older = true; break; }
          const key = `${report.date}_${report.number}`;
          if (seen.has(key)) throw new Error("通知書一覧に重複があります。");
          seen.add(key);
          if (saved.has(key)) { skipped++; continue; }
          status(`JA通知書を取得中。取得 ${added}件、保存済み ${skipped}件`);
          let result;
          try {
            result = await api("/import", { date: report.date, number: report.number });
          } catch (error) {
            throw new Error(`通知書 ${report.date} / ${report.number}: ${error.message}`);
          }
          if (!["saved", "already_saved"].includes(result.status)) throw new Error("取り込み結果を確認できません。");
          saved.add(key);
          if (result.status === "saved") added++;
          else skipped++;
        }
        if (older || !listing.hasNext) break;
        if (!listing.reports.length || page >= 1000) throw new Error("通知書一覧の続きが不正です。");
        page++;
      }
    }
  } catch (error) {
    try { await refresh(); } catch (refreshError) {
      throw new Error(`${error.message} 保存済みデータの更新にも失敗しました: ${refreshError.message}`);
    }
    throw new Error(`${error.message} 途中までの取得 ${added}件は保存済みです。再実行できます。`);
  }
  await refresh();
  status(`取得 ${added}件、保存済み ${skipped}件。集計には取り込み済みの通常の通知書のみ含まれます。`);
}

async function run(action) {
  if (busy) return;
  busy = true;
  el("sync").disabled = el("refresh").disabled = true;
  try { await action(); }
  catch (error) { console.error("[sales] operation failed", error); status(error.message, true); }
  finally { busy = false; el("sync").disabled = !loaded; el("refresh").disabled = false; }
}

window.addEventListener("DOMContentLoaded", async () => {
  if (!await verifyLocalAuth()) return;
  if (!["admin", "family"].includes(window.currentRole)) {
    location.replace("/index.html");
    return;
  }
  renderHeader();
  el("page-area").hidden = false;
  el("from").value = startDate;
  el("to").value = todayLocalYmd();
  el("login").addEventListener("click", () => run(() => login(`/sales/index.html${location.search}${location.hash}`)));
  el("refresh").addEventListener("click", () => run(async () => { await refresh(); status("保存済みデータを更新しました。"); }));
  el("sync").addEventListener("click", () => run(sync));
  for (const id of ["from", "to"]) el(id).addEventListener("change", () => {
    try { render(); status(""); } catch (error) { status(error.message, true); }
  });
  if (!hasSession()) {
    el("login-area").hidden = false;
    status("Cognitoアカウントでログインしてください。");
    return;
  }
  el("data-area").hidden = false;
  el("sync").disabled = true;
  await run(async () => { await refresh(); status("保存済みデータを取得しました。"); });
});
