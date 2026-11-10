import { verifyLocalAuth } from "/common/ui.js";
import { showSaveResult } from "/common/save-modal.js?v=20261105-result-1";
import { renderHeader } from "/common/header.js?v=1.1";
import { config } from "/photos/config.js";
import { clearSession, ensureToken, hasSession, login } from "/photos/auth.js?v=20261029-2";
import {
  categories, chartScale, filterItems, flattenItems, formatYen, latestForecast, monthlyTotals,
  annualCategoryTotals, annualComparison, nextForecast, periodPreset, needsReview, sortItems, unclassifiedGroups, uploadOutcome,
} from "./finance-logic.js?v=20261107-dashboard-1";
import { todayLocalYmd } from "/common/date-utils.js?v=1";

const el = id => document.getElementById(id);
const pageSize = 30;
let invoices = [];
let imports = [];
let items = [];
let page = 0;
let busy = false;
let editItem = null;
let editGroup = null;
let savingEdit = false;

function node(tag, text, className) {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  if (className) result.className = className;
  return result;
}

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
  const response = await fetch(`${config.api}/finance${path}`, {
    method: body === undefined ? "GET" : "POST",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (response.status === 401) {
    clearSession();
    el("login-area").hidden = false;
    el("data-area").hidden = true;
    throw new Error("ログインをやり直してください。");
  }
  if (response.status === 403) {
    el("login-area").hidden = false;
    el("data-area").hidden = true;
    throw new Error("JA経費分析はCognitoのadmin / familyのみ利用できます。");
  }
  if (!response.ok) {
    let message = `経費APIの処理に失敗しました（${response.status}）。`;
    const text = await response.text();
    try {
      const body = JSON.parse(text);
      if (typeof body.message === "string") message += ` ${body.message}`;
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
    throw new Error(message);
  }
  return response.json();
}

async function run(action) {
  if (busy) return;
  busy = true;
  updateButtons();
  try {
    await action();
  } catch (error) {
    console.error("Finance operation failed", error);
    status(error.message, true);
  } finally {
    busy = false;
    updateButtons();
  }
}

function updateButtons() {
  el("data-area").querySelectorAll("button").forEach(button => { button.disabled = busy; });
  el("login").disabled = busy;
  el("pdf").disabled = busy;
  if (!busy) updatePagination();
}

async function loadData() {
  // Replace the visible data only after every request succeeds.
  const [list, history] = await Promise.all([api("/invoices"), api("/imports")]);
  const records = [];
  for (const invoice of list.invoices) {
    records.push(await api(`/invoices/${encodeURIComponent(invoice.invoice_no)}`));
  }
  invoices = records;
  imports = history.imports;
  items = flattenItems(invoices);
  page = 0;
  render();
  renderForecasts();
  renderInvoices();
  renderImports();
  updateAnnualYears();
  renderAnnualChart();
  renderOverview();
  el("data-area").hidden = false;
  el("login-area").hidden = true;
  el("updated-at").textContent = `最終取得：${new Date().toLocaleString("ja-JP")}（財務データは端末に保存しません）`;
  renderLinkedInvoice(new URLSearchParams(location.search));
  if (location.hash === "#invoice-upload") {
    el("invoice-upload").closest("details").open = true;
    el("invoice-upload").scrollIntoView({ block: "start" });
  }
}

function renderLinkedInvoice(params) {
  const panel = el("linked-invoice-panel");
  panel.hidden = !params.has("invoice");
  if (panel.hidden) return;
  const invoiceNo = params.get("invoice");
  const valid = /^\d{6,12}$/.test(invoiceNo) && (!params.has("source") || params.get("source") === "ja");
  const invoice = valid ? invoices.find(value => value.invoice_no === invoiceNo) : null;
  el("linked-invoice-items").replaceChildren();
  el("linked-invoice-summary").textContent = "";
  const back = el("linked-bank-return");
  back.hidden = !/^[a-f0-9]{64}$/.test(params.get("statement") || "") || !/^[a-f0-9]{64}$/.test(params.get("transaction") || "");
  if (!back.hidden) back.href = `/bank/index.html?statement=${encodeURIComponent(params.get("statement"))}&transaction=${encodeURIComponent(params.get("transaction"))}#details-section`;
  el("linked-invoice-status").textContent = !valid ? "請求書リンクの指定が不正です。"
    : !invoice ? "指定された請求書は見つかりません。取り込み状況を確認してください。"
    : invoice.validation_status === "failed" ? "この請求書は検証失敗です。内容を確認してください。" : "指定されたJA請求書の最新の内容です。";
  if (invoice) {
    el("linked-invoice-summary").textContent = `JA請求書 ${invoice.invoice_no} ／ 引落予定日 ${invoice.settlement_date} ／ 請求額 ${formatYen(invoice.total_amount)}`;
    for (const item of invoice.items) {
      const row = node("tr");
      row.append(...[item.trade_date, `${item.item_name} ${item.spec || ""}`, item.department,
        formatYen(item.amount), `${item.category}${item.subcategory ? ` / ${item.subcategory}` : ""}`].map(value => node("td", value)));
      el("linked-invoice-items").append(row);
    }
  }
  panel.scrollIntoView({ block: "start" });
}

function filters() {
  return {
    basis: el("basis").value, from: el("from").value, to: el("to").value,
    category: el("category").value, query: el("query").value,
  };
}

function filteredItems(forDetails = false) {
  const values = filters();
  if (values.from && values.to && values.from > values.to) return [];
  return filterItems(items, {
    ...values,
    reviewOnly: forDetails && el("review-only").checked,
    machineOnly: forDetails && el("machine-only").checked,
  });
}

function statistic(label, value) {
  const card = node("div", undefined, "finance-stat");
  card.append(node("span", label), node("strong", value));
  return card;
}

function render() {
  const values = filters();
  el("filter-error").textContent = values.from && values.to && values.from > values.to
    ? "開始月は終了月以前にしてください。" : "";
  el("filter-state").textContent = [
    `集計：${values.basis === "settlement" ? "決済月" : "取引日の月"}`,
    `期間：${values.from || "開始指定なし"}〜${values.to || "終了指定なし"}`,
    `分類：${values.category || "すべて"}`, `検索：${values.query || "なし"}`,
    ...(el("review-only").checked ? ["明細：要確認・未分類のみ"] : []),
    ...(el("machine-only").checked ? ["明細：農機課のみ"] : []),
  ].join(" ／ ");
  const filtered = filteredItems();
  const total = filtered.reduce((sum, item) => sum + item.amount, 0);
  el("summary").replaceChildren(
    statistic("選択条件の合計（税込）", formatYen(total)),
    statistic("明細数", `${filtered.length}件`),
    actionStatistic("要確認・未分類", `${filtered.filter(item => needsReview(item) || item.category === "未分類").length}件`, () => openAttention("details")),
  );
  const rows = monthlyTotals(filtered, values.basis);
  const legend = el("legend");
  legend.replaceChildren();
  for (const [index, category] of categories.entries()) {
    const label = node("span");
    label.append(node("span", "", `finance-key category-${index}`), document.createTextNode(category));
    legend.append(label);
  }
  renderChart(rows);
  const head = node("tr");
  for (const label of ["月", ...categories, "合計"]) head.append(node("th", label));
  el("monthly-head").replaceChildren(head);
  el("monthly-body").replaceChildren(...rows.map(row => {
    const tr = node("tr");
    tr.append(node("th", row.month));
    for (const category of categories) tr.append(node("td", formatYen(row.categories[category] || 0)));
    tr.append(node("td", formatYen(row.total)));
    return tr;
  }));
  renderItems();
  renderGroups(filtered);
  const unclassifiedCount = unclassifiedGroups(filtered).reduce((sum, group) => sum + group.items.length, 0);
  updateAttention("groups", unclassifiedCount, "未分類");
  updateAttention("details", filtered.filter(item => needsReview(item) || item.category === "未分類").length, "要確認・未分類");
}

function actionStatistic(label, value, action) {
  const result = node("button", undefined, "finance-stat finance-stat-action");
  result.type = "button";
  result.disabled = busy;
  result.append(node("span", label), node("strong", value));
  result.addEventListener("click", action);
  return result;
}

function openAttention(prefix, allData = false) {
  if (busy || savingEdit) return;
  if (allData) clearFilters(false);
  if (prefix === "details") {
    el("review-only").checked = true;
    el("machine-only").checked = false;
  }
  page = 0;
  render();
  const panel = el(`${prefix}-section`);
  panel.open = true;
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
  panel.querySelector("summary").focus();
}

function applyPeriod(preset) {
  if (busy || savingEdit) return;
  const range = periodPreset(preset, todayLocalYmd());
  el("from").value = range.from;
  el("to").value = range.to;
  page = 0;
  render();
}

function clearFilters(redraw = true) {
  el("basis").value = "trade";
  for (const id of ["from", "to", "category", "query"]) el(id).value = "";
  el("review-only").checked = el("machine-only").checked = false;
  el("detail-sort").value = "date-desc";
  page = 0;
  if (redraw) render();
}

function renderOverview() {
  const today = todayLocalYmd();
  const annual = annualCategoryTotals(items, today);
  const next = nextForecast(invoices, today);
  const unclassified = unclassifiedGroups(items).reduce((sum, group) => sum + group.items.length, 0);
  const review = items.filter(item => needsReview(item) || item.category === "未分類").length;
  el("overview").replaceChildren(
    statistic("今年の経費累計（税込）", formatYen(annual.total)),
    statistic(next ? `次回引落予定（未確定） ${next.month}${next.onwards ? "以降" : ""}` : "次回引落予定（未確定）",
      next ? formatYen(next.amount) : "当月以降の予定記載なし"),
    actionStatistic("未分類の整理（全データ）", `${unclassified}件`, () => openAttention("groups", true)),
    actionStatistic("要確認・未分類（全データ）", `${review}件`, () => openAttention("details", true)),
  );
  el("overview-period").textContent = `${annual.start}〜${annual.end}・取引日基準の取り込み済み分。件数は全取り込みデータ（検索条件とは独立）。次回予定は最新請求書の当月以降の記載分で、引落済みかどうかは判定しません。`;
}

function updateAttention(prefix, count, label) {
  const badge = el(`${prefix}-attention`);
  badge.textContent = count ? `！${label} ${count}件` : "";
  badge.hidden = count === 0;
  el(`${prefix}-section`).classList.toggle("finance-needs-attention", count > 0);
}

function updateAnnualYears() {
  const todayYear = todayLocalYmd().slice(0, 4);
  const selected = el("annual-year").value;
  const years = [...new Set([todayYear, ...items.map(item => item.trade_date.slice(0, 4))])]
    .filter(year => year <= todayYear).sort().reverse();
  el("annual-year").replaceChildren(...years.map(year => {
    const option = node("option", `${year}年`);
    option.value = year;
    return option;
  }));
  el("annual-year").value = years.includes(selected) ? selected : todayYear;
}

function renderAnnualChart() {
  const year = Number(el("annual-year").value);
  const comparison = annualComparison(items, todayLocalYmd(), year);
  const annual = comparison.current;
  el("annual-period").textContent = `${annual.start} 〜 ${annual.end} ／ 合計 ${formatYen(annual.total)}`;
  const closingMonths = invoices.filter(invoice => invoice.closing_date >= annual.start && invoice.closing_date <= annual.end)
    .map(invoice => invoice.closing_date.slice(0, 7));
  el("annual-coverage").textContent = `取引がある月：${comparison.currentMonths.join("、") || "なし"} ／ 取り込み済み請求書の締め月：${[...new Set(closingMonths)].sort().join("、") || "なし"} ／ 前年の取引がある月：${comparison.previousMonths.join("、") || "なし"}`;
  el("annual-comparison").textContent = `前年同期間：${comparison.previous.start}〜${comparison.previous.end} ／ `
    + (comparison.difference === null ? "比較対象の明細が不足しているため比較できません。"
      : `${formatYen(comparison.previous.total)} ／ 差額 ${comparison.difference > 0 ? "+" : ""}${formatYen(comparison.difference)}`
        + (comparison.percent === null ? "（前年合計が0以下のため増減率なし）" : `（${comparison.percent > 0 ? "+" : ""}${comparison.percent.toFixed(1)}%）`));
  const area = el("annual-chart");
  area.replaceChildren();
  if (annual.drawable) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 120 120");
    svg.setAttribute("class", "finance-donut");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `${year}年の分類割合：${annual.rows.map(row => `${row.category} ${row.percent.toFixed(1)}%`).join("、")}`);
    let offset = 0;
    for (const row of annual.rows.filter(row => row.amount > 0)) {
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      for (const [key, value] of Object.entries({
        cx: 60, cy: 60, r: 44, fill: "none", "stroke-width": 20, pathLength: 100,
        "stroke-dasharray": `${row.percent} ${100 - row.percent}`,
        "stroke-dashoffset": -offset, transform: "rotate(-90 60 60)",
        class: `category-${categories.indexOf(row.category)}`,
      })) circle.setAttribute(key, String(value));
      svg.appendChild(circle);
      offset += row.percent;
    }
    area.append(svg);
  } else {
    area.append(node("p", annual.rows.some(row => row.amount < 0)
      ? "返品等で分類別合計がマイナスのため、円グラフは表示せず金額を表示します。"
      : "対象年の分類割合を表示できる購入金額がありません。"));
  }
  const table = node("table");
  table.append(node("caption", `${year}年の分類別金額・割合`));
  const head = node("tr");
  for (const label of ["分類", "金額（税込）", "割合"]) head.append(node("th", label));
  const thead = node("thead");
  thead.append(head);
  const body = node("tbody");
  for (const row of annual.rows) {
    const tr = node("tr");
    const name = node("th");
    name.append(node("span", "", `finance-key category-${categories.indexOf(row.category)}`), document.createTextNode(row.category));
    tr.append(name, node("td", formatYen(row.amount)), node("td", row.percent === null ? "—" : `${row.percent.toFixed(1)}%`));
    body.append(tr);
  }
  table.append(thead, body);
  const scroll = node("div", undefined, "finance-scroll");
  scroll.tabIndex = 0;
  scroll.setAttribute("role", "region");
  scroll.setAttribute("aria-label", `${year}年の分類別金額・割合`);
  scroll.append(table);
  area.append(scroll);
}

function selectMonth(month) {
  if (busy || savingEdit) return;
  el("from").value = el("to").value = month;
  el("detail-sort").value = "amount-desc";
  el("review-only").checked = el("machine-only").checked = false;
  page = 0;
  render();
  el("details-section").open = true;
  el("details-section").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderChart(rows) {
  const chart = el("chart");
  chart.replaceChildren();
  if (!rows.length) {
    chart.append(node("p", "対象の明細がありません。"));
    return;
  }
  const { maximum, ticks } = chartScale(rows);
  const axis = node("div", undefined, "finance-axis");
  const plot = node("div", undefined, "finance-plot");
  const grid = node("div", undefined, "finance-grid");
  grid.setAttribute("aria-hidden", "true");
  for (const tick of ticks) {
    const position = `${(1 - tick / maximum) * 100}%`;
    const label = node("span", tick >= 10000 ? `${tick / 10000}万円` : formatYen(tick));
    label.style.top = position;
    axis.append(label);
    const line = node("div", undefined, "finance-gridline");
    line.style.top = position;
    grid.append(line);
  }
  const columns = node("div", undefined, "finance-columns");
  for (const row of rows) {
    const column = node("button", undefined, "finance-column");
    column.type = "button";
    column.disabled = busy;
    column.setAttribute("aria-label", `${row.month} ${formatYen(row.total)}：この月の明細を金額順で表示`);
    column.addEventListener("click", () => selectMonth(row.month));
    const stack = node("div", undefined, "finance-stack");
    for (const [index, category] of categories.entries()) {
      const amount = row.categories[category] || 0;
      const segment = node("div", "", `finance-segment category-${index}`);
      segment.style.height = `${Math.max(0, amount) / maximum * 100}%`;
      segment.title = `${category}：${formatYen(amount)}`;
      stack.append(segment);
    }
    column.append(node("span", formatYen(row.total)), stack, node("span", row.month));
    columns.append(column);
  }
  plot.append(grid, columns);
  chart.append(axis, plot);
}

function updatePagination() {
  const count = filteredItems(true).length;
  const pages = Math.max(1, Math.ceil(count / pageSize));
  page = Math.min(page, pages - 1);
  el("previous").disabled = busy || page === 0;
  el("next").disabled = busy || page >= pages - 1;
  el("page-number").textContent = `${page + 1} / ${pages}ページ（${count}件）`;
}

function renderItems() {
  updatePagination();
  const list = sortItems(filteredItems(true), el("detail-sort").value);
  const body = el("items");
  body.replaceChildren();
  for (const item of list.slice(page * pageSize, (page + 1) * pageSize)) {
    const tr = node("tr", undefined, needsReview(item) ? "finance-review" : "");
    const dateCell = node("td", item.trade_date);
    dateCell.append(node("small", `請求書 ${item.invoice_no}\n決済 ${item.settlement_date}`));
    const product = node("td", item.item_name);
    product.append(node("small", `${item.spec}\n${item.department}${item.note ? ` / ${item.note}` : ""}`));
    const quantity = node("td", item.quantity ?? "—");
    quantity.append(node("small", item.unit_price == null ? "単価 —" : `単価 ${item.unit_price}円`));
    const category = node("td", item.category);
    category.append(node("small", `${item.subcategory || "—"}\n${item.classified_by === "manual" ? "手動確定" : item.classified_by === "rule(dept)" ? "部署推定" : "自動分類"}`));
    const edit = node("td");
    if (item.review_reason) edit.append(node("small", item.review_reason));
    const button = node("button", "分類修正", "secondary-btn");
    button.type = "button";
    button.disabled = busy;
    button.addEventListener("click", () => openEdit(item));
    edit.append(button);
    if (item.needs_review && item.category !== "未分類") {
      if (item.review_confirmed === true) edit.append(node("small", "確認済み"));
      const review = node("button", item.review_confirmed === true ? "要確認に戻す" : "確認済みにする", "secondary-btn");
      review.type = "button";
      review.disabled = busy;
      review.addEventListener("click", () => run(() => saveReview(item)));
      edit.append(review);
    }
    tr.append(dateCell, product, quantity, node("td", formatYen(item.amount)), category, edit);
    body.append(tr);
  }
  if (!list.length) {
    const cell = node("td", "対象の明細がありません。");
    cell.colSpan = 6;
    const row = node("tr");
    row.append(cell);
    body.append(row);
  }
}

async function saveReview(item) {
  const confirmed = item.review_confirmed !== true;
  if (!confirm(confirmed
    ? "この明細を確認済みにします。必要な税理士確認・資産計上／修繕費の判断が済んでいることを確認してください。注意文は残ります。"
    : "この明細を要確認に戻しますか？")) return;
  const result = await api("/classifications", {
    invoice_no: item.invoice_no, line_seq: item.line_seq, review_confirmed: confirmed,
  });
  if (result.review_confirmed !== confirmed) throw new Error("確認状態の保存結果を確認できません。最新データに更新してください。");
  await loadData();
  const message = confirmed ? "確認済みにしました。" : "要確認に戻しました。";
  status(message);
  await showSaveResult(message);
}

function renderGroups(filtered) {
  const groups = unclassifiedGroups(filtered);
  const body = el("unclassified-groups");
  body.replaceChildren();
  el("group-summary").textContent = `現在の期間・分類・検索条件内：${groups.length}商品グループ / ${groups.reduce((sum, group) => sum + group.items.length, 0)}明細`;
  for (const group of groups) {
    const row = node("tr");
    const product = node("td", group.item_name);
    product.append(node("small", group.department));
    const button = node("button", "まとめて分類", "secondary-btn");
    button.type = "button";
    button.disabled = busy;
    button.addEventListener("click", () => openGroup(group));
    const action = node("td");
    action.append(button);
    row.append(product, node("td", `${group.items.length}件`), node("td", formatYen(group.total)), action);
    body.append(row);
  }
  if (!groups.length) {
    const row = node("tr");
    const cell = node("td", "対象の未分類明細はありません。");
    cell.colSpan = 4;
    row.append(cell);
    body.append(row);
  }
}

function renderForecasts() {
  const latest = latestForecast(invoices);
  el("forecasts").replaceChildren();
  if (!latest) {
    el("forecast-source").textContent = "請求書はまだありません。";
    return;
  }
  el("forecast-source").textContent = `${latest.issue_date}発行 / 請求書 ${latest.invoice_no} に基づく未確定の予定`;
  for (const forecast of latest.forecasts) {
    el("forecasts").append(statistic(`${forecast.settlement_month}${forecast.onwards ? "以降" : ""} 決済予定`, formatYen(forecast.amount)));
  }
  if (!latest.forecasts.length) el("forecasts").append(node("p", "この請求書に請求予定の記載はありません。"));
  if (latest.forecast_total !== null) el("forecasts").append(statistic("予定合計", formatYen(latest.forecast_total)));
}

function renderInvoices() {
  el("invoices").replaceChildren();
  for (const invoice of invoices) {
    const row = node("div", undefined, "finance-record");
    row.append(node("p", `${invoice.issue_date}発行 / ${invoice.invoice_no}\n${formatYen(invoice.total_amount)} / ${invoice.items.length}明細${invoice.warnings.length ? `\n警告：${invoice.warnings.join(" / ")}` : ""}`));
    const button = node("button", "PDFを再取り込み", "secondary-btn");
    button.type = "button";
    button.addEventListener("click", () => run(async () => {
      if (!confirm(`請求書 ${invoice.invoice_no} を再取り込みします。手動分類は保持します。`)) return;
      status("再取り込み中…");
      const result = await api("/reimport", { invoice_no: invoice.invoice_no });
      await loadData();
      const outcome = uploadOutcome(result);
      status([outcome.message, ...result.validation_errors, ...result.warnings].join("\n"), outcome.failed);
    }));
    row.append(button);
    el("invoices").append(row);
  }
  if (!invoices.length) el("invoices").append(node("p", "請求書はまだありません。PDFを取り込んでください。"));
}

function renderImports() {
  el("imports").replaceChildren();
  for (const report of imports) {
    const row = node("div", undefined, "finance-record");
    const label = { ok: "成功", warning: "警告あり", failed: "保留" }[report.validation_status];
    row.append(node("p", `${new Date(report.imported_at).toLocaleString("ja-JP")} / ${report.invoice_no || "請求書番号未取得"} / ${label}\n${[...report.validation_errors, ...report.warnings].join("\n")}`));
    const button = node("button", "検証結果・未解析行", "secondary-btn");
    button.type = "button";
    button.addEventListener("click", () => run(async () => showReport(await api(`/imports/${encodeURIComponent(report.import_id)}`))));
    row.append(button);
    el("imports").append(row);
  }
  if (!imports.length) el("imports").append(node("p", "取り込み履歴はまだありません。"));
}

function showReport(report) {
  const outcome = uploadOutcome(report);
  el("report-content").textContent = [
    outcome.message,
    `請求書：${report.invoice_no || "未取得"}`,
    ...report.validation_errors,
    ...report.warnings,
    `未解析行：${report.unparsed_lines.length}件`,
    ...report.unparsed_lines,
  ].join("\n");
  el("report-dialog").showModal();
}

function openEdit(item) {
  editGroup = null;
  el("dictionary-fields").hidden = false;
  el("edit-title").textContent = "分類修正";
  editItem = item;
  el("edit-item").textContent = `${item.trade_date} / ${item.item_name} ${item.spec} / ${formatYen(item.amount)}`;
  el("edit-category").value = item.category;
  el("edit-subcategory").value = item.subcategory;
  el("remember").checked = false;
  el("keyword").value = item.item_name;
  el("keyword").disabled = true;
  el("edit-status").textContent = "";
  el("edit-dialog").showModal();
}

function openGroup(group) {
  editItem = null;
  editGroup = { ...group, items: [...group.items], saved: 0 };
  el("dictionary-fields").hidden = true;
  el("edit-title").textContent = "未分類をまとめて修正";
  el("edit-item").textContent = [
    `${group.item_name} / ${group.department}`,
    `${group.items.length}件 / 合計 ${formatYen(group.total)}`,
    "表示条件内の同じ品名・部署が対象です（規格違いを含む）。手動確定済みは変更しません。",
    ...group.items.map(item => `${item.trade_date} / 請求書 ${item.invoice_no} 行${item.line_seq} / ${item.spec || "規格なし"} / ${formatYen(item.amount)}`),
  ].join("\n");
  el("edit-category").value = "未分類";
  el("edit-subcategory").value = "";
  el("edit-status").textContent = "";
  el("edit-dialog").showModal();
}

async function saveGroup() {
  if (savingEdit || busy) return;
  const category = el("edit-category").value;
  const subcategory = el("edit-subcategory").value.trim();
  if (category === "未分類") {
    el("edit-status").textContent = "変更先の分類を選択してください。";
    return;
  }
  savingEdit = busy = true;
  updateButtons();
  el("save-edit").disabled = el("cancel-edit").disabled = true;
  el("edit-category").disabled = el("edit-subcategory").disabled = true;
  let message;
  let failed = false;
  try {
    while (editGroup.items.length) {
      const item = editGroup.items[0];
      el("edit-status").textContent = `${editGroup.saved}件保存済み、残り${editGroup.items.length}件を保存中…`;
      await api("/classifications", {
        invoice_no: item.invoice_no, line_seq: item.line_seq, category, subcategory, remember: false,
      });
      editGroup.items.shift();
      editGroup.saved++;
    }
    message = `${editGroup.saved}件の分類を保存しました。`;
    el("edit-dialog").close();
  } catch (error) {
    failed = true;
    message = `${editGroup.saved}件保存済み、残り${editGroup.items.length}件は未完了です。再度「保存」で残りのみ再試行します。 ${error.message}`;
    el("edit-status").textContent = message;
  }
  try {
    await loadData();
  } catch (error) {
    failed = true;
    message += ` 表示の更新に失敗しました。「最新データに更新」で確認してください。 ${error.message}`;
  } finally {
    savingEdit = busy = false;
    updateButtons();
    el("save-edit").disabled = el("cancel-edit").disabled = false;
    el("edit-category").disabled = el("edit-subcategory").disabled = false;
    status(message, failed);
    await showSaveResult(message);
  }
}

async function saveEdit(event) {
  event.preventDefault();
  if (editGroup) return saveGroup();
  if (savingEdit || busy || !editItem) return;
  const remember = el("remember").checked;
  if (remember && !el("keyword").value.trim()) {
    el("edit-status").textContent = "辞書キーワードを入力してください。";
    return;
  }
  savingEdit = busy = true;
  updateButtons();
  el("save-edit").disabled = el("cancel-edit").disabled = true;
  el("edit-status").textContent = "保存中…";
  try {
    await api("/classifications", {
      invoice_no: editItem.invoice_no, line_seq: editItem.line_seq,
      category: el("edit-category").value, subcategory: el("edit-subcategory").value.trim(),
      remember, keyword: el("keyword").value.trim(),
    });
    el("edit-dialog").close();
    status("分類を保存しました。最新データを取得しています…");
    try {
      await loadData();
    } catch (error) {
      throw new Error(`分類は保存済みですが、表示の更新に失敗しました。 ${error.message}`);
    }
    status("分類を保存しました。");
    await showSaveResult("分類を保存しました。");
  } catch (error) {
    el("edit-status").textContent = error.message;
    status(error.message, true);
    await showSaveResult(error.message);
  } finally {
    savingEdit = busy = false;
    updateButtons();
    el("save-edit").disabled = el("cancel-edit").disabled = false;
  }
}

async function uploadPdf() {
  const file = el("pdf").files[0];
  if (!file || !file.name.toLowerCase().endsWith(".pdf")) throw new Error("PDFファイルを選択してください。");
  if (file.size < 1 || file.size > 20 * 1024 * 1024) throw new Error("PDFは1バイト以上20MB以下にしてください。");
  status("アップロード先を準備しています…");
  const ticket = await api("/uploads", {});
  const form = new FormData();
  for (const [key, value] of Object.entries(ticket.upload.fields)) form.append(key, value);
  form.append("file", file);
  const uploaded = await fetch(ticket.upload.url, { method: "POST", body: form, credentials: "omit" });
  if (!uploaded.ok) throw new Error(`PDFのアップロードに失敗しました（${uploaded.status}）。`);
  const importId = ticket.key.split("/").pop().replace(/\.pdf$/, "");
  status("PDFアップロード済み。解析結果を待っています…");
  for (let attempt = 0; attempt < 24; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 2500));
    const history = await api("/imports");
    if (history.imports.some(report => report.import_id === importId)) {
      const report = await api(`/imports/${encodeURIComponent(importId)}`);
      await loadData();
      el("pdf").value = "";
      const outcome = uploadOutcome(report);
      status([outcome.message, ...report.validation_errors, ...report.warnings].join("\n"), outcome.failed);
      showReport(report);
      return;
    }
  }
  await loadData();
  status("PDFはアップロード済みですが、取り込み結果をまだ確認できません。「最新データに更新」で再確認してください。再アップロードは不要です。", true);
}

async function initialize() {
  if (!await verifyLocalAuth()) return;
  if (!["admin", "family"].includes(window.currentRole)) {
    location.replace("/index.html");
    return;
  }
  renderHeader();
  el("page-area").hidden = false;
  for (const category of categories) {
    for (const id of ["category", "edit-category"]) {
      const option = node("option", category);
      option.value = category;
      el(id).append(option);
    }
  }
  el("login").addEventListener("click", () => run(() => login(`/finance/index.html${location.search}${location.hash}`)));
  el("refresh").addEventListener("click", () => run(async () => {
    status("最新データを取得しています…");
    await loadData();
    status("最新データを取得しました。");
  }));
  el("upload").addEventListener("click", () => run(uploadPdf));
  el("clear-period").addEventListener("click", () => {
    el("from").value = el("to").value = "";
    page = 0;
    render();
  });
  document.querySelectorAll("[data-period]").forEach(button => {
    button.addEventListener("click", () => applyPeriod(button.dataset.period));
  });
  el("clear-filters").addEventListener("click", () => {
    if (!busy && !savingEdit) clearFilters();
  });
  el("annual-year").addEventListener("change", renderAnnualChart);
  el("details-attention").addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    openAttention("details");
  });
  for (const id of ["basis", "from", "to", "category", "query", "review-only", "machine-only", "detail-sort"]) {
    el(id).addEventListener("input", () => { page = 0; render(); });
  }
  el("previous").addEventListener("click", () => { page--; renderItems(); });
  el("next").addEventListener("click", () => { page++; renderItems(); });
  el("remember").addEventListener("change", () => { el("keyword").disabled = !el("remember").checked; });
  el("edit-form").addEventListener("submit", saveEdit);
  el("cancel-edit").addEventListener("click", () => el("edit-dialog").close());
  el("edit-dialog").addEventListener("cancel", event => { if (savingEdit) event.preventDefault(); });
  el("close-report").addEventListener("click", () => el("report-dialog").close());
  if (!hasSession()) {
    el("login-area").hidden = false;
    status("Cognitoアカウントでログインしてください。");
    return;
  }
  await run(async () => {
    status("経費データを取得しています…");
    await loadData();
    status("経費データを取得しました。");
  });
}

initialize().catch(error => {
  el("page-area").hidden = false;
  status(error.message, true);
});
