import { verifyLocalAuth } from "/common/ui.js";
import { renderHeader } from "/common/header.js?v=1.1";
import { showSaveResult } from "/common/save-modal.js?v=20261105-result-1";
import { config } from "/photos/config.js";
import { clearSession, ensureToken, hasSession, login } from "/photos/auth.js?v=20261029-2";
import { todayLocalYmd } from "/common/date-utils.js?v=1";
import { formatYen, periodPreset } from "/finance/finance-logic.js?v=20261107-dashboard-1";
import { categories, flattenStatements, filterItems, totals, monthlyTotals, needsAttention, sortItems,
  unclassifiedGroups, annualAnalysis, relatedItems } from "./bank-logic.js?v=20261109-2";

const el = id => document.getElementById(id);
const pageSize = 30;
const colors = ["#398651", "#3279af", "#9360b2", "#be6d32", "#258d92", "#a35f83", "#797330", "#465774", "#6b7280"];
let statements = [], imports = [], items = [];
let page = 0, busy = false, targets = [], revisions = new Map();
let editStarted = false, editSelection = [];

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
  const result = await fetch(`${config.api}/bank${path}`, {
    method: body === undefined ? "GET" : "POST", cache: "no-store",
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (result.status === 401 || result.status === 403) {
    if (result.status === 401) clearSession();
    el("login-area").hidden = false;
    el("data-area").hidden = true;
    throw new Error(result.status === 401 ? "再ログインしてください。" : "口座明細はCognitoのadmin / familyのみ利用できます。");
  }
  if (!result.ok) {
    let message = `口座APIの処理に失敗しました（${result.status}）。`;
    const text = await result.text();
    try {
      const value = JSON.parse(text);
      if (typeof value.message === "string") message += ` ${value.message}`;
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
    throw new Error(message);
  }
  return result.json();
}

function updateButtons() {
  el("page-area").querySelectorAll("button").forEach(button => { button.disabled = busy; });
  el("data-area").querySelectorAll("input, select").forEach(input => { input.disabled = busy; });
  el("edit-form").querySelectorAll("input, select").forEach(input => { input.disabled = busy || editStarted; });
  if (!busy) {
    const count = filtered().length;
    el("previous").disabled = page <= 0;
    el("next").disabled = (page + 1) * pageSize >= count;
  }
}

async function run(action) {
  if (busy) return;
  busy = true;
  updateButtons();
  try { await action(); }
  catch (error) {
    console.error("[bank] operation failed", error);
    status(error.message, true);
  } finally {
    busy = false;
    updateButtons();
  }
}

function filters() {
  return { account: el("account").value, from: el("from").value, to: el("to").value,
    category: el("category").value, direction: el("direction").value, query: el("query").value,
    reviewOnly: el("review-only").checked };
}

function filtered() {
  const current = filters();
  return current.from && current.to && current.from > current.to ? [] : filterItems(items, current);
}

async function loadData() {
  const [list, history] = await Promise.all([api("/statements"), api("/imports")]);
  if (!Array.isArray(list.statements) || !Array.isArray(history.imports)) throw new Error("口座APIの一覧形式が不正です。");
  const records = [];
  for (const record of list.statements) records.push(await api(`/statements/${encodeURIComponent(record.statement_id)}`));
  const rows = flattenStatements(records);
  statements = records;
  imports = history.imports;
  items = rows;
  page = 0;
  const selectedAccount = el("account").value;
  el("account").replaceChildren();
  for (const [id, label] of new Map(records.map(record => [record.account_id, record.account_label]))) {
    const option = node("option", label);
    option.value = id;
    el("account").append(option);
  }
  if (records.some(record => record.account_id === selectedAccount)) el("account").value = selectedAccount;
  const selectedYear = el("annual-year").value;
  const year = Number(todayLocalYmd().slice(0, 4));
  el("annual-year").replaceChildren();
  for (const value of [...new Set([year, ...records.map(record => Number(record.month.slice(0, 4))).filter(value => value <= year)])].sort((a, b) => b - a)) {
    const option = node("option", `${value}年`);
    option.value = String(value);
    el("annual-year").append(option);
  }
  if ([...el("annual-year").options].some(option => option.value === selectedYear)) el("annual-year").value = selectedYear;
  el("data-area").hidden = false;
  el("login-area").hidden = true;
  el("updated-at").textContent = `最終取得：${new Date().toLocaleString("ja-JP")}`;
  render();
  renderRecords();
}

function stat(label, value, action) {
  const box = node(action ? "button" : "div", label, "finance-stat");
  if (action) {
    box.type = "button";
    box.disabled = busy;
    box.classList.add("finance-stat-action");
    box.onclick = action;
  }
  box.append(node("strong", value));
  return box;
}

function showAttention() {
  clearFilters();
  el("review-only").checked = true;
  render();
  el("details-section").open = true;
  el("details-section").scrollIntoView({ behavior: "smooth", block: "start" });
}

function clearFilters() {
  for (const id of ["from", "to", "category", "query", "direction"]) el(id).value = "";
  el("review-only").checked = false;
  el("sort").value = "date-desc";
  page = 0;
  render();
}

function badge(id, count) {
  el(id).hidden = count === 0;
  el(id).textContent = `！${count}件`;
  el(id).closest("details").classList.toggle("finance-needs-attention", count > 0);
}

function render() {
  const current = filters(), list = filtered();
  el("filter-error").textContent = current.from && current.to && current.from > current.to ? "開始月は終了月以前にしてください。" : "";
  el("filter-state").textContent = `期間：${current.from || "指定なし"}〜${current.to || "指定なし"} ／ 用途：${current.category || "すべて"} ／ 入出金：${current.direction === "deposit" ? "入金" : current.direction === "withdrawal" ? "出金" : "すべて"} ／ 検索：${current.query || "なし"}${current.reviewOnly ? " ／ 要確認のみ" : ""}`;
  const total = totals(list);
  el("summary").replaceChildren(stat("条件内入金", formatYen(total.deposit)), stat("条件内出金", formatYen(total.withdrawal)), stat("条件内差引", formatYen(total.net)));
  const accountItems = items.filter(item => item.account_id === current.account);
  const accountRecords = statements.filter(record => record.account_id === current.account).sort((a, b) => b.month.localeCompare(a.month));
  const latest = accountRecords[0];
  const annual = annualAnalysis(accountItems, accountRecords, current.account, Number(todayLocalYmd().slice(0, 4)), todayLocalYmd());
  el("overview").replaceChildren(
    stat("今年の入金（現在まで）", formatYen(annual.current.deposit)), stat("今年の出金（現在まで）", formatYen(annual.current.withdrawal)),
    stat(latest ? `${latest.month} 月末残高` : "月末残高", latest ? formatYen(latest.closing_balance) : "未取り込み"),
    stat("要確認・未分類", `${accountItems.filter(needsAttention).length}件`, showAttention));
  renderMonthly(monthlyTotals(list, statements, current));
  const groups = unclassifiedGroups(list);
  el("groups").replaceChildren();
  for (const group of groups) {
    const row = node("tr"), cell = node("td"), button = node("button", "まとめて分類", "secondary-btn");
    button.type = "button";
    button.disabled = busy;
    button.onclick = () => openEdit(group.items);
    cell.append(button);
    row.append(node("td", group.memo || "摘要なし"), node("td", group.direction), node("td", `${group.items.length}件 / ${formatYen(group.total)}`), cell);
    el("groups").append(row);
  }
  emptyTable("groups", groups.length, 4);
  badge("groups-attention", groups.reduce((sum, group) => sum + group.items.length, 0));
  badge("details-attention", list.filter(needsAttention).length);
  renderItems();
  renderAnnual();
}

function emptyTable(id, count, columns) {
  if (count) return;
  const row = node("tr"), cell = node("td", "対象の明細がありません。");
  cell.colSpan = columns;
  row.append(cell);
  el(id).append(row);
}

function selectMonth(month) {
  if (busy) return;
  el("from").value = el("to").value = month;
  el("sort").value = "amount-desc";
  page = 0;
  render();
  el("details-section").open = true;
  el("details-section").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderMonthly(rows) {
  el("monthly").replaceChildren();
  el("chart").replaceChildren(node("p", "緑：入金 ／ 青：出金"));
  const maximum = Math.max(1, ...rows.flatMap(row => [row.deposit, row.withdrawal]));
  for (const row of rows) {
    const tr = node("tr"), month = node("button", row.month, "secondary-btn"), cell = node("td");
    month.type = "button";
    month.disabled = busy;
    month.onclick = () => selectMonth(row.month);
    cell.append(month);
    tr.append(cell, ...[row.deposit, row.withdrawal, row.net, row.opening, row.closing].map(amount => node("td", amount === null ? "—" : formatYen(amount))));
    el("monthly").append(tr);
    const button = node("button", row.month, "bank-month");
    button.type = "button";
    button.disabled = busy;
    button.setAttribute("aria-label", `${row.month} 入金${formatYen(row.deposit)} 出金${formatYen(row.withdrawal)}。明細を開く`);
    const bars = node("span", undefined, "bank-bars");
    for (const direction of ["deposit", "withdrawal"]) {
      const bar = node("span", undefined, `bank-bar bank-${direction}`);
      bar.style.height = `${row[direction] / maximum * 160}px`;
      bars.append(bar);
    }
    button.append(bars);
    button.onclick = () => selectMonth(row.month);
    el("chart").append(button);
  }
  emptyTable("monthly", rows.length, 6);
}

function renderItems() {
  const list = sortItems(filtered(), el("sort").value);
  page = Math.min(Math.max(0, page), Math.max(0, Math.ceil(list.length / pageSize) - 1));
  el("items").replaceChildren();
  for (const item of list.slice(page * pageSize, (page + 1) * pageSize)) {
    const row = node("tr", undefined, needsAttention(item) ? "finance-review" : "");
    const memo = node("td", item.memo || "摘要なし");
    memo.append(node("small", item.note));
    const cell = node("td", `${item.category} / ${item.classified_by === "manual" ? "手動確定" : "分類候補"}`);
    cell.append(node("small", item.review_confirmed ? "確認済み" : item.review_reason));
    const edit = node("button", "分類修正", "secondary-btn");
    edit.type = "button";
    edit.disabled = busy;
    edit.onclick = () => openEdit([item]);
    cell.append(edit);
    if (item.category !== "未分類") {
      const review = node("button", item.review_confirmed ? "要確認に戻す" : "確認済みにする", "secondary-btn");
      review.type = "button";
      review.disabled = busy;
      review.onclick = () => run(() => saveReview(item));
      cell.append(review);
    }
    row.append(node("td", item.trade_date), memo, node("td", item.deposit ? formatYen(item.deposit) : "—"),
      node("td", item.withdrawal ? formatYen(item.withdrawal) : "—"), node("td", formatYen(item.balance)), cell);
    el("items").append(row);
  }
  emptyTable("items", list.length, 6);
  el("page-number").textContent = `${page + 1} / ${Math.max(1, Math.ceil(list.length / pageSize))}（${list.length}件）`;
  el("previous").disabled = busy || page === 0;
  el("next").disabled = busy || (page + 1) * pageSize >= list.length;
}

function renderAnnual() {
  const year = Number(el("annual-year").value || todayLocalYmd().slice(0, 4));
  const analysis = annualAnalysis(items, statements, el("account").value, year, todayLocalYmd());
  el("annual-period").textContent = `${analysis.period.start}〜${analysis.period.end}`;
  el("annual-coverage").textContent = `取り込み済み月：${analysis.months.join("、") || "なし"} ／ 前年同期間：${analysis.priorMonths.join("、") || "なし"}（未取り込み分がある場合は参考値）`;
  el("annual-comparison").textContent = !analysis.months.length || !analysis.priorMonths.length
    ? "前年同期間の明細が不足しているため比較できません。"
    : `前年同期間比：入金 ${formatYen(analysis.current.deposit - analysis.prior.deposit)} ／ 出金 ${formatYen(analysis.current.withdrawal - analysis.prior.withdrawal)} ／ 差引 ${formatYen(analysis.current.net - analysis.prior.net)}`;
  el("annual").replaceChildren();
  for (const direction of ["deposit", "withdrawal"]) {
    const part = node("div", undefined, "bank-annual-part");
    const total = analysis.current[direction];
    part.append(node("h3", `${direction === "deposit" ? "入金" : "出金"}：${formatYen(total)}`));
    if (total > 0) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 120 120");
      svg.setAttribute("class", "bank-donut");
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", `${direction === "deposit" ? "入金" : "出金"}の用途割合。下の表に金額・割合を表示。`);
      let offset = 0;
      analysis.categories.forEach((row, index) => {
        const percent = row[direction] / total * 100;
        if (!percent) return;
        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        for (const [key, value] of Object.entries({ cx: 60, cy: 60, r: 45, fill: "none", stroke: colors[index],
          "stroke-width": 16, pathLength: 100, "stroke-dasharray": `${percent} ${100 - percent}`, "stroke-dashoffset": -offset, transform: "rotate(-90 60 60)" })) circle.setAttribute(key, value);
        svg.append(circle);
        offset += percent;
      });
      part.append(svg);
    } else part.append(node("p", "対象の入出金がありません。"));
    const scroll = node("div", undefined, "finance-scroll"), table = node("table"), head = node("tr");
    scroll.tabIndex = 0;
    head.append(node("th", "用途"), node("th", "金額"), node("th", "割合"));
    const thead = node("thead"), tbody = node("tbody");
    thead.append(head);
    for (const [index, row] of analysis.categories.entries()) {
      const tr = node("tr");
      const category = node("td");
      const key = node("span", undefined, "finance-key");
      key.style.background = colors[index];
      key.setAttribute("aria-hidden", "true");
      category.append(key, document.createTextNode(row.category));
      tr.append(category, node("td", formatYen(row[direction])), node("td", total > 0 ? `${(row[direction] / total * 100).toFixed(1)}%` : "—"));
      tbody.append(tr);
    }
    table.append(thead, tbody);
    scroll.append(table);
    part.append(scroll);
    el("annual").append(part);
  }
}

function showReport(report) {
  el("report-content").textContent = [
    `${report.month || "月不明"}：${report.validation_status === "failed" ? "検証失敗・月次明細へ未反映" : "取り込み完了"}`,
    ...(report.validation_errors || []), ...(report.warnings || []),
  ].join("\n");
  el("report-dialog").showModal();
}

function renderRecords() {
  el("statements").replaceChildren();
  for (const record of statements.filter(record => record.account_id === el("account").value)) {
    const row = node("div", undefined, "finance-record"), button = node("button", "再取り込み", "secondary-btn");
    row.append(node("p", `${record.month} / ${record.items.length}件\n${record.warnings.join("\n")}`));
    button.type = "button";
    button.disabled = busy;
    button.onclick = () => run(async () => {
      if (!confirm(`${record.month}の保存済みPDFを再解析します。同一取引の手動分類は維持します。`)) return;
      const report = await api("/reimport", { statement_id: record.statement_id, revision: record.revision });
      status(report.saved ? "再取り込み済み。表示を更新しています…" : "検証失敗のため月次明細は更新していません。", !report.saved);
      try { await loadData(); }
      catch (error) { throw new Error(`再解析は完了しましたが、表示更新に失敗しました。 ${error.message}`); }
      showReport(report);
    });
    row.append(button);
    el("statements").append(row);
  }
  el("imports").replaceChildren();
  for (const report of imports) {
    const row = node("div", undefined, "finance-record"), button = node("button", "結果を確認", "secondary-btn");
    row.append(node("p", `${report.imported_at} / ${report.month || "月不明"} / ${report.validation_status === "failed" ? "検証失敗・未反映" : "取り込み完了"}`));
    button.type = "button";
    button.disabled = busy;
    button.onclick = () => showReport(report);
    row.append(button);
    el("imports").append(row);
  }
  if (!imports.length) el("imports").append(node("p", "取り込み履歴はまだありません。"));
}

function openEdit(selected) {
  if (busy) return;
  editStarted = false;
  editSelection = [];
  targets = [...selected];
  revisions = new Map(statements.map(record => [record.statement_id, record.revision]));
  el("edit-item").textContent = `${selected.length}件：${selected[0].memo || "摘要なし"}`;
  el("edit-category").value = selected[0].category;
  el("edit-note").value = selected.length === 1 ? selected[0].note : "";
  el("edit-status").textContent = "";
  el("edit-confirm").checked = false;
  el("edit-related").hidden = selected.length !== 1;
  el("edit-related-items").replaceChildren();
  if (selected.length === 1) {
    for (const item of [selected[0], ...relatedItems(items, selected[0])]) {
      const label = node("label", undefined, "bank-edit-choice"), checkbox = node("input");
      checkbox.type = "checkbox";
      checkbox.checked = item === selected[0];
      label.append(checkbox, node("span", `${item.trade_date} / ${item.deposit ? "入金" : "出金"} ${formatYen(item.deposit + item.withdrawal)} / ${item.category}${item.classified_by === "manual" ? "・手動修正済み" : ""}${item.review_confirmed ? "・確認済み" : ""}`));
      el("edit-related-items").append(label);
      editSelection.push({ item, checkbox });
    }
  }
  updateButtons();
  el("edit-dialog").showModal();
}

async function saveEdit(event) {
  event.preventDefault();
  if (busy) return;
  if (!editStarted && editSelection.length) targets = editSelection.filter(choice => choice.checkbox.checked).map(choice => choice.item);
  if (!targets.length) {
    el("edit-status").textContent = "保存する明細を選択してください。";
    return;
  }
  if (targets.length > 1 && el("edit-category").value === "未分類") {
    el("edit-status").textContent = "まとめて整理する場合は、未分類以外の用途を選択してください。";
    return;
  }
  if (el("edit-confirm").checked && el("edit-category").value === "未分類") {
    el("edit-status").textContent = "確認済みにする場合は、未分類以外の用途を選択してください。";
    return;
  }
  if (!editStarted) {
    const primary = editSelection[0]?.item;
    targets = targets.map(item => ({ ...item,
      editNote: !primary || item === primary ? el("edit-note").value.trim() : item.note,
      pendingReview: false }));
    editStarted = true;
  }
  await run(async () => {
    let saved = 0;
    try {
      while (targets.length) {
        const item = targets[0];
        const result = await api("/classifications", { statement_id: item.statement_id, transaction_id: item.transaction_id,
          revision: revisions.get(item.statement_id),
          ...(item.pendingReview ? { review_confirmed: true } : { category: el("edit-category").value, note: item.editNote }) });
        if (result.saved !== true || typeof result.revision !== "string") throw new Error("分類の保存結果を確認できません。最新データを取得してください。");
        revisions.set(item.statement_id, result.revision);
        if (!item.pendingReview && el("edit-confirm").checked) {
          item.pendingReview = true;
          continue;
        }
        targets.shift();
        saved++;
      }
    } catch (error) {
      el("edit-status").textContent = `${saved}件保存済み・残り${targets.length}件。${targets[0]?.pendingReview ? "先頭の明細は分類保存済み・確認状態の保存待ちです。" : ""}${error.message} 409の場合は閉じて最新データを取得し、対象を選び直してください。`;
      throw new Error(el("edit-status").textContent);
    }
    el("edit-dialog").close();
    try { await loadData(); }
    catch (error) { throw new Error(`分類は保存済みですが、表示更新に失敗しました。 ${error.message}`); }
    status("分類を保存しました。");
    await showSaveResult("分類を保存しました。");
  });
}

async function saveReview(item) {
  const confirmed = !item.review_confirmed;
  if (!confirm(confirmed ? "この取引の用途・分類を確認済みにしますか？" : "この取引を要確認に戻しますか？")) return;
  const record = statements.find(record => record.statement_id === item.statement_id);
  const result = await api("/classifications", { statement_id: item.statement_id, transaction_id: item.transaction_id,
    revision: record.revision, review_confirmed: confirmed });
  if (result.saved !== true) throw new Error("確認状態の保存結果を確認できません。");
  try { await loadData(); }
  catch (error) { throw new Error(`確認状態は保存済みですが、表示更新に失敗しました。 ${error.message}`); }
  status(confirmed ? "確認済みにしました。" : "要確認に戻しました。");
  await showSaveResult(confirmed ? "確認済みにしました。" : "要確認に戻しました。");
}

async function uploadPdf() {
  const file = el("pdf").files[0];
  if (!file || !file.name.toLowerCase().endsWith(".pdf") || file.size < 1 || file.size > 20 * 1024 * 1024) {
    throw new Error("1バイト以上20MB以下のPDFを選択してください。");
  }
  status("アップロード先を準備しています…");
  const ticket = await api("/uploads", {});
  const form = new FormData();
  for (const [key, value] of Object.entries(ticket.upload.fields)) form.append(key, value);
  form.append("file", file);
  const result = await fetch(ticket.upload.url, { method: "POST", body: form, credentials: "omit" });
  if (!result.ok) throw new Error(`PDFアップロードに失敗しました（${result.status}）。`);
  const importId = ticket.key.split("/").pop().replace(/\.pdf$/, "");
  status("アップロード済み。解析結果を待っています…");
  for (let attempt = 0; attempt < 24; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 2500));
    const history = await api("/imports");
    const report = history.imports.find(report => report.import_id === importId);
    if (report) {
      try { await loadData(); }
      catch (error) { throw new Error(`PDFの解析結果は届きましたが、表示更新に失敗しました。 ${error.message}`); }
      el("pdf").value = "";
      status(report.validation_status === "failed" ? "検証失敗のため月次明細への反映を保留しました。" : "PDFの取り込みが完了しました。", report.validation_status === "failed");
      showReport(report);
      return;
    }
  }
  status("PDFはアップロード済みですが、解析結果は未確認です。「最新データに更新」で再確認してください。再アップロードは不要です。", true);
}

async function initialize() {
  if (!await verifyLocalAuth()) return;
  if (!["admin", "family"].includes(window.currentRole)) { location.replace("/index.html"); return; }
  renderHeader();
  el("page-area").hidden = false;
  for (const category of categories) for (const id of ["category", "edit-category"]) {
    const option = node("option", category);
    option.value = category;
    el(id).append(option);
  }
  el("login").onclick = () => run(() => login("/bank/index.html"));
  el("refresh").onclick = () => run(async () => { status("最新データを取得しています…"); await loadData(); status("最新データを取得しました。"); });
  el("upload").onclick = () => run(uploadPdf);
  el("clear-filters").onclick = clearFilters;
  for (const id of ["account", "from", "to", "category", "direction", "query", "review-only", "sort"]) {
    el(id).addEventListener("input", () => { page = 0; render(); if (id === "account") renderRecords(); });
  }
  document.querySelectorAll("[data-period]").forEach(button => {
    button.onclick = () => {
      const period = periodPreset(button.dataset.period, todayLocalYmd());
      el("from").value = period.from;
      el("to").value = period.to;
      page = 0;
      render();
    };
  });
  el("annual-year").onchange = renderAnnual;
  el("details-attention").onclick = event => {
    event.preventDefault();
    event.stopPropagation();
    el("review-only").checked = true;
    page = 0;
    render();
    el("details-section").open = true;
  };
  el("previous").onclick = () => { page--; renderItems(); };
  el("next").onclick = () => { page++; renderItems(); };
  el("edit-form").onsubmit = saveEdit;
  el("cancel-edit").onclick = () => el("edit-dialog").close();
  el("edit-dialog").addEventListener("cancel", event => { if (busy) event.preventDefault(); });
  el("close-report").onclick = () => el("report-dialog").close();
  if (!hasSession()) { el("login-area").hidden = false; status("Cognitoアカウントでログインしてください。"); return; }
  await run(async () => { status("口座データを取得しています…"); await loadData(); status("口座データを取得しました。"); });
}

initialize().catch(error => {
  console.error("[bank] initialization failed", error);
  el("page-area").hidden = false;
  status(error.message, true);
});
