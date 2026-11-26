import { verifyLocalAuth } from "/common/ui.js";
import { renderHeader } from "/common/header.js?v=1.1";
import { loadCSV } from "/common/csv.js?v=20260820";
import { todayLocalYmd } from "/common/date-utils.js?v=1";
import { hasSession, login } from "/photos/auth.js?v=20261029-2";
import { analyzeSales } from "./sales-logic.js?v=20261125-1";
import { salesApi as api, openSettlementPdf } from "./sales-api.js?v=20261125-1";

const startDate = "2026-11-01";
const el = id => document.getElementById(id);
const lastSyncKey = "sales-last-successful-sync";
let reports = [], weights = [], busy = false, loaded = false;

function status(message, error = false) {
  el("status").textContent = message;
  el("status").classList.toggle("error", error);
}

function addRow(id, values) {
  const row = document.createElement("tr");
  for (const value of values) {
    const cell = document.createElement("td");
    if (value instanceof Node) cell.appendChild(value);
    else cell.textContent = value;
    row.appendChild(cell);
  }
  el(id).appendChild(row);
}

const format = value => new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 }).format(value);

function stat(label, value) {
  const box = document.createElement("div");
  box.className = "finance-stat";
  box.append(document.createTextNode(label));
  const strong = document.createElement("strong");
  strong.textContent = value;
  box.append(strong);
  el("summary").append(box);
}

function reportButton(row) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = `${row.reportDate} / ${row.reportNumber}（PDF）`;
  button.addEventListener("click", () => openSettlementPdf(row.reportDate, row.reportNumber)
    .catch(error => { console.error("[sales] PDF", error); status(error.message, true); }));
  return button;
}

function reviewCell(row) {
  const cell = document.createElement("div");
  cell.textContent = row.matchReason ? `${row.matchStatus}：${row.matchReason}` : row.matchStatus;
  if (row.matchReason) {
    const params = new URLSearchParams({ from: row.shippingDate, to: row.shippingDate });
    const kpi = document.createElement("a");
    kpi.href = `/performance/kpi-month.html?${params}`;
    kpi.textContent = " 出荷状況を見る";
    cell.append(kpi);
  }
  if (row.matchReason && window.currentRole === "admin") {
    const link = document.createElement("a");
    const params = new URLSearchParams({ type: "weight", file: "all.csv", search: row.shippingDate });
    link.href = `/admin/edit-csv/index.html?${params}`;
    link.textContent = " 出荷記録を確認";
    cell.append(link);
  }
  return cell;
}

function renderTrends(monthly) {
  const area = el("trends");
  area.replaceChildren();
  if (!monthly.length) { area.textContent = "対象期間に取得済みの明細はありません。"; return; }
  const maxAmount = Math.max(...monthly.map(row => row.amount), 1);
  const maxPrice = Math.max(...monthly.map(row => row.amount / row.quantity), 1);
  for (const row of monthly) {
    for (const [label, value, max, cls] of [
      ["売上", row.amount, maxAmount, ""], ["平均単価", row.amount / row.quantity, maxPrice, "sales-unit-bar"],
    ]) {
      const line = document.createElement("div");
      line.className = "sales-trend";
      const title = document.createElement("span");
      title.textContent = `${row.month} ${row.product} ${label}`;
      const bar = document.createElement("div");
      bar.className = `sales-bar ${cls}`;
      const fill = document.createElement("span");
      fill.style.width = `${100 * value / max}%`;
      bar.append(fill);
      const number = document.createElement("span");
      number.textContent = `${format(value)}円`;
      line.append(title, bar, number);
      area.append(line);
    }
  }
}

function render() {
  for (const id of ["monthly", "items", "summary"]) el(id).replaceChildren();
  el("matching").textContent = "";
  if (el("from").value < startDate) throw new Error("開始日は2026年11月1日以降にしてください。");
  const result = analyzeSales(reports, weights, el("from").value, el("to").value);
  const total = result.rows.reduce((sum, item) => sum + item.amount, 0);
  const products = new Set(result.rows.map(row => row.product));
  const quantity = result.rows.reduce((sum, item) => sum + item.quantity, 0);
  stat("取得済み税抜売上", `${format(total)}円`);
  stat("精算数量", products.size === 1 ? format(quantity) : "品名別を参照");
  stat("平均単価", products.size === 1 && quantity ? `${format(total / quantity)}円` : "品名別を参照");
  stat("要確認", `${result.rows.filter(item => item.matchStatus === "要確認").length}明細`);
  const allocated = result.allocations.reduce((sum, item) => sum + item.amount, 0);
  el("matching").textContent = `照合済み売上 ${format(allocated)}円 / 圃場別未割当 ${format(total - allocated)}円 / 対応する精算明細がない出荷日 ${result.unmatchedShippingDates.length}日${result.unmatchedShippingDates.length ? `（${result.unmatchedShippingDates.join("、")}）` : ""}`;
  renderTrends(result.monthly);
  for (const row of result.monthly) addRow("monthly", [row.month, row.product, format(row.quantity), `${format(row.amount)}円`, `${format(row.amount / row.quantity)}円`]);
  for (const row of result.rows.sort((a, b) => b.shippingDate.localeCompare(a.shippingDate))) {
    addRow("items", [row.shippingDate, row.product, format(row.quantity), `${format(row.unitPrice)}円`,
      `${format(row.amount)}円`, reviewCell(row), reportButton(row)]);
  }
  const params = new URLSearchParams({ from: el("from").value, to: el("to").value });
  el("kpi-link").href = `/performance/kpi-month.html?${params}`;
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
  localStorage.setItem(lastSyncKey, new Date().toISOString());
  showLastSync();
  status(`取得 ${added}件、保存済み ${skipped}件。集計には取り込み済みの通常の通知書のみ含まれます。`);
}

function showLastSync() {
  const value = localStorage.getItem(lastSyncKey);
  const date = value ? new Date(value) : null;
  el("last-sync").textContent = date && !Number.isNaN(date.valueOf())
    ? `この端末で最後にJA一覧を確認した日時：${date.toLocaleString("ja-JP")}`
    : "この端末でのJA一覧確認日時は未記録です。";
}

function selectPeriod(period) {
  const today = todayLocalYmd();
  const [year, month] = today.split("-").map(Number);
  const start = period === "previous" ? new Date(year, month - 2, 1)
    : new Date(year, period === "year" ? 0 : month - 1, 1);
  const end = period === "previous" ? new Date(year, month - 1, 0) : new Date(year, month - 1, Number(today.slice(8)));
  const ymd = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  el("from").value = ymd(start) < startDate ? startDate : ymd(start);
  el("to").value = ymd(end);
  render();
}

async function run(action) {
  if (busy) return;
  busy = true;
  el("sync").disabled = el("refresh").disabled = true;
  try { await action(); }
  catch (error) {
    console.error("[sales] operation failed", error);
    if (!hasSession() || error.status === 401 || error.status === 403) {
      el("login-area").hidden = false;
      el("data-area").hidden = true;
      loaded = false;
    }
    status(error.message, true);
  }
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
  const params = new URLSearchParams(location.search);
  el("from").value = params.get("from") || startDate;
  el("to").value = params.get("to") || todayLocalYmd();
  showLastSync();
  el("login").addEventListener("click", () => run(() => login(`/sales/index.html${location.search}${location.hash}`)));
  el("refresh").addEventListener("click", () => run(async () => { await refresh(); status("保存済みデータを更新しました。"); }));
  el("sync").addEventListener("click", () => run(sync));
  document.querySelectorAll("[data-period]").forEach(button => button.addEventListener("click", () => {
    try { selectPeriod(button.dataset.period); status(""); } catch (error) { status(error.message, true); }
  }));
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
