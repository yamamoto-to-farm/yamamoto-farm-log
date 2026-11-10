import { verifyLocalAuth } from "/common/ui.js";
import { renderHeader } from "/common/header.js?v=1.1";
import { showSaveResult } from "/common/save-modal.js?v=20261105-result-1";
import { config } from "/photos/config.js";
import { clearSession, ensureToken, hasSession, login } from "/photos/auth.js?v=20261029-2";
import { todayLocalYmd } from "/common/date-utils.js?v=1";
import { formatYen, periodPreset, chartScale } from "/finance/finance-logic.js?v=20261107-dashboard-1";
import { categories, flattenStatements, filterItems, totals, monthlyTotals, needsAttention, sortItems,
  unclassifiedGroups, annualAnalysis, relatedItems, subcategories, itemParts, allocatedItems, validateAllocations,
  statementCoverage, balanceTrend, unclassifiedSummary } from "./bank-logic.js?v=20261110-4";

const el = id => document.getElementById(id);
const pageSize = 30;
const colors = ["#398651", "#3279af", "#9360b2", "#be6d32", "#258d92", "#a35f83", "#797330", "#465774", "#6b7280",
  "#a86a19", "#6352a5", "#237b78", "#b25365", "#7d7045", "#436f8f"];
let statements = [], imports = [], items = [];
let page = 0, busy = false, targets = [], revisions = new Map();
let editStarted = false, editSelection = [];
let editPrimary = null;
let ruleState = { rules: [], revision: "" }, pendingRule = null, editingRuleId = null;
let splitItem = null, splitRevision = "", splitRows = [], splitSaved = false;

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
  el("rule-form").querySelectorAll("input, select").forEach(input => { input.disabled = busy; });
  el("split-form").querySelectorAll("input, select").forEach(input => { input.disabled = busy || splitSaved; });
  el("save-split").disabled = busy || splitSaved;
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
    category: el("category").value, subcategory: el("subcategory").value, direction: el("direction").value, query: el("query").value,
    reviewOnly: el("review-only").checked };
}

function filtered() {
  const current = filters();
  return current.from && current.to && current.from > current.to ? [] : filterItems(items, current);
}

async function loadData() {
  const [list, history, rules] = await Promise.all([api("/statements"), api("/imports"), api("/rules")]);
  if (!Array.isArray(rules.rules) || typeof rules.revision !== "string") throw new Error("分類ルールの取得結果が不正です。");
  ruleState = rules;
  if (!Array.isArray(list.statements) || !Array.isArray(history.imports)) throw new Error("口座APIの一覧形式が不正です。");
  const records = [];
  for (const record of list.statements) records.push(await api(`/statements/${encodeURIComponent(record.statement_id)}`));
  const rows = flattenStatements(records);
  statements = records;
  imports = history.imports;
  items = rows;
  const selectedSubcategory = el("subcategory").value;
  el("subcategory").replaceChildren(node("option", "すべて"));
  el("subcategory").firstElementChild.value = "";
  const details = [...new Set([...Object.values(subcategories).flat(), ...items.flatMap(item => itemParts(item).map(part => part.subcategory))])].filter(Boolean).sort();
  for (const value of details) {
    const option = node("option", value);
    option.value = value;
    el("subcategory").append(option);
  }
  el("subcategory").value = details.includes(selectedSubcategory) ? selectedSubcategory : "";
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
  renderRules();
}

function renderRules() {
  el("rules-list").replaceChildren();
  for (const rule of ruleState.rules.filter(rule => rule.account_id === el("account").value)) {
    const row = node("div", undefined, "finance-record");
    row.append(node("p", `${rule.direction === "deposit" ? "入金" : "出金"} ／「${rule.contains}」を含む → ${rule.category}${rule.subcategory ? ` / ${rule.subcategory}` : ""}`));
    const edit = node("button", "変更", "secondary-btn"), remove = node("button", "削除", "secondary-btn");
    edit.type = remove.type = "button";
    edit.disabled = remove.disabled = busy;
    edit.onclick = () => {
      editingRuleId = rule.rule_id;
      el("rule-contains").value = rule.contains;
      el("rule-category").value = rule.category;
      el("rule-subcategory").value = rule.subcategory || "";
      el("rule-direction").value = rule.direction;
      el("rule-status").textContent = "";
      el("rule-dialog").showModal();
    };
    remove.onclick = () => run(async () => {
      if (!confirm(`「${rule.contains}」の分類ルールを削除しますか？保存済み明細は変更しません。`)) return;
      const result = await api("/rules", { revision: ruleState.revision, rule_id: rule.rule_id, delete: true });
      acceptRules(result);
      renderRules();
      status("ルールを削除しました。保存済み明細は変更していません。");
    });
    row.append(edit, remove);
    el("rules-list").append(row);
  }
  if (!el("rules-list").children.length) el("rules-list").append(node("p", "この口座の保存ルールはありません。"));
}

function acceptRules(result) {
  if (result.saved !== true || !Array.isArray(result.rules) || typeof result.revision !== "string" || !result.revision) {
    throw new Error("ルールの保存結果を確認できません。最新データを取得してください。");
  }
  ruleState = result;
}

async function saveRule(event) {
  event.preventDefault();
  await run(async () => {
    try {
      const rule = ruleState.rules.find(rule => rule.rule_id === editingRuleId);
      if (!rule) throw new Error("変更対象のルールがありません。最新データを取得してください。");
      acceptRules(await api("/rules", { revision: ruleState.revision, rule_id: rule.rule_id, account_id: rule.account_id,
        direction: el("rule-direction").value, contains: el("rule-contains").value.trim(), category: el("rule-category").value,
        subcategory: el("rule-subcategory").value.trim() }));
      el("rule-dialog").close();
      renderRules();
      status("ルールを変更しました。次回の取り込み・再取り込みから適用されます。");
    } catch (error) {
      el("rule-status").textContent = `${error.message} 競合の場合は閉じて最新データを取得してください。`;
      throw error;
    }
  });
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

function showUnclassified() {
  clearFilters();
  el("category").value = "未分類";
  el("sort").value = "amount-desc";
  render();
  el("details-section").open = true;
  el("details-section").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderAccountOverview(accountItems, accountRecords, account) {
  const latest = accountRecords[0];
  const coverage = statementCoverage(accountRecords, account);
  el("coverage").textContent = coverage
    ? `取り込み済み実績：${coverage.start}〜${coverage.end}（${coverage.months.length}か月分）。残高は${coverage.end}時点で、現在の口座残高ではありません。`
    : "取り込み済みの口座明細はありません。";
  el("coverage-gaps").textContent = coverage?.missing.length ? `期間内の未取り込み月：${coverage.missing.join("、")}。集計には含まれません。` : "";
  const annual = annualAnalysis(accountItems, accountRecords, account, Number(todayLocalYmd().slice(0, 4)), todayLocalYmd());
  el("overview").replaceChildren(
    stat("今年の入金（取込済み実績）", formatYen(annual.current.deposit)), stat("今年の出金（取込済み実績）", formatYen(annual.current.withdrawal)),
    stat(latest ? `${latest.month} 月末残高` : "月末残高", latest ? formatYen(latest.closing_balance) : "未取り込み"),
    stat("要確認・未分類", `${accountItems.filter(needsAttention).length}件`, showAttention));
  const unknown = unclassifiedSummary(accountItems);
  el("unclassified-summary").replaceChildren(
    stat("未分類の取引（全取込期間）", `${unknown.count}件`, showUnclassified),
    stat("未分類の入金", formatYen(unknown.deposit), showUnclassified),
    stat("未分類の出金", formatYen(unknown.withdrawal), showUnclassified));
}

function clearFilters() {
  for (const id of ["from", "to", "category", "subcategory", "query", "direction"]) el(id).value = "";
  el("review-only").checked = false;
  el("sort").value = "date-desc";
  page = 0;
  render();
}

function setDetailsQuery(value) {
  if (busy) return;
  el("query").value = value;
  page = 0;
  render();
}

function badge(id, count) {
  el(id).hidden = count === 0;
  el(id).textContent = id === "details-attention" ? `要確認 ${count}件` : `！${count}件`;
  el(id).closest("details").classList.toggle("finance-needs-attention", count > 0);
}

function render() {
  const current = filters(), list = filtered();
  el("details-query").value = current.query;
  el("filter-error").textContent = current.from && current.to && current.from > current.to ? "開始月は終了月以前にしてください。" : "";
  el("filter-state").textContent = `期間：${current.from || "指定なし"}〜${current.to || "指定なし"} ／ 用途：${current.category || "すべて"} ／ 内訳：${current.subcategory || "すべて"} ／ 入出金：${current.direction === "deposit" ? "入金" : current.direction === "withdrawal" ? "出金" : "すべて"} ／ 検索：${current.query || "なし"}${current.reviewOnly ? " ／ 要確認のみ" : ""}`;
  const allocated = current.from && current.to && current.from > current.to ? [] : filterItems(allocatedItems(items), current);
  const total = totals(allocated);
  el("summary").replaceChildren(stat("条件内入金", formatYen(total.deposit)), stat("条件内出金", formatYen(total.withdrawal)), stat("条件内差引", formatYen(total.net)));
  const accountItems = items.filter(item => item.account_id === current.account);
  const accountRecords = statements.filter(record => record.account_id === current.account).sort((a, b) => b.month.localeCompare(a.month));
  renderAccountOverview(accountItems, accountRecords, current.account);
  renderMonthly(monthlyTotals(allocated, statements, current), balanceTrend(statements, current));
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

function renderMonthly(rows, trend = rows.map(row => ({ month: row.month, balance: row.closing }))) {
  el("monthly").replaceChildren();
  for (const row of rows) {
    const tr = node("tr"), month = node("button", row.month, "secondary-btn"), cell = node("td");
    month.type = "button";
    month.disabled = busy;
    month.onclick = () => selectMonth(row.month);
    cell.append(month);
    tr.append(cell, ...[row.deposit, row.withdrawal, row.net, row.opening, row.closing].map(amount => node("td", amount === null ? "—" : formatYen(amount))));
    el("monthly").append(tr);
  }
  emptyTable("monthly", rows.length, 6);
  const amounts = new Map(rows.map(row => [row.month, row]));
  renderCombinedChart(trend.map(row => ({ ...row, deposit: amounts.get(row.month)?.deposit ?? 0,
    withdrawal: amounts.get(row.month)?.withdrawal ?? 0 })));
}

function renderCombinedChart(rows) {
  const area = el("chart");
  const mode = el("chart-mode").value || "combined";
  const showBars = mode !== "balance", showBalance = mode !== "cashflow";
  const graphLabel = mode === "cashflow" ? "月別入出金の推移" : mode === "balance"
    ? "月末残高の推移（口座全体）" : "月別入出金・月末残高の推移（共通の金額軸）";
  el("chart-legend").textContent = [
    ...(showBars ? ["緑の棒：入金", "青の棒：出金"] : []),
    ...(showBalance ? ["紫の線：月末残高（口座全体）"] : []),
  ].join(" ／ ");
  area.setAttribute("aria-label", graphLabel);
  el("balance-minimum").hidden = !showBalance;
  area.replaceChildren();
  el("chart-detail").textContent = "棒・点にマウスを合わせるかフォーカスすると、その月の入金・出金・月末残高を表示します。";
  const available = rows.filter(row => row.balance !== null);
  if (!available.length) {
    area.append(node("p", "対象期間に取り込み済みの残高がありません。"));
    el("balance-minimum").textContent = "期間内の最低月末残高：データなし";
    return;
  }
  const minimum = Math.min(...available.map(row => row.balance));
  el("balance-minimum").textContent = `期間内の最低月末残高：${formatYen(minimum)}（${available.filter(row => row.balance === minimum).map(row => row.month).join("、")}）。月途中の最低残高ではありません。`;
  const scale = chartScale(rows.flatMap(row => [...(showBars ? [row.deposit, row.withdrawal] : []),
    ...(showBalance ? [Math.abs(row.balance ?? 0)] : [])]
    .map(amount => ({ categories: { amount } }))));
  const lower = showBalance && minimum < 0 ? -scale.maximum : 0;
  const upper = scale.maximum;
  const width = Math.max(420, rows.length * 90 + 130), left = 85, right = width - 20, top = 25, bottom = 205;
  const slot = (right - left) / rows.length;
  const x = index => left + (index + 0.5) * slot;
  const y = balance => top + (upper - balance) / (upper - lower) * (bottom - top);
  const svgNode = (tag, attributes, text) => {
    const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const svg = svgNode("svg", { viewBox: `0 0 ${width} 255`, width, height: 255, class: "bank-balance-svg",
    role: "group", "aria-label": graphLabel, "aria-describedby": "chart-detail" });
  const ticks = [...new Set([...(lower < 0 ? scale.ticks.map(value => -value) : []), ...(upper > 0 ? scale.ticks : [0])])].sort((a, b) => a - b);
  for (const tick of ticks) {
    svg.append(svgNode("line", { x1: left, x2: right, y1: y(tick), y2: y(tick), class: "bank-balance-grid", "aria-hidden": "true" }),
      svgNode("text", { x: left - 8, y: y(tick) + 4, "text-anchor": "end", class: "bank-balance-label", "aria-hidden": "true" },
        Math.abs(tick) >= 10000 ? `${tick / 10000}万円` : formatYen(tick)));
  }
  const bars = svgNode("g", {}), lines = svgNode("g", {}), points = svgNode("g", {});
  svg.append(bars, lines, points);
  const interactive = (element, description, month) => {
    element.setAttribute("tabindex", 0);
    element.setAttribute("role", "button");
    element.setAttribute("aria-label", `${description}。明細を開く`);
    element.append(svgNode("title", {}, description));
    element.onmouseenter = element.onfocus = () => { el("chart-detail").textContent = description; };
    element.onclick = () => selectMonth(month);
    element.onkeydown = event => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectMonth(month); }
    };
  };
  let previous = null;
  for (const [index, row] of rows.entries()) {
    svg.append(svgNode("text", { x: x(index), y: 235, "text-anchor": "middle", class: "bank-balance-label", "aria-hidden": "true" }, row.month));
    if (row.balance === null) {
      svg.append(svgNode("text", { x: x(index), y: 155, "text-anchor": "middle", class: "bank-balance-label" }, "未取り込み"));
      previous = null;
      continue;
    }
    const description = `${row.month} ／ 入金：${formatYen(row.deposit)} ／ 出金：${formatYen(row.withdrawal)} ／ 月末残高（口座全体）：${formatYen(row.balance)}`;
    for (const [offset, direction] of (showBars ? ["deposit", "withdrawal"] : []).entries()) {
      const bar = svgNode("rect", { x: x(index) + (offset - 1) * 24, y: y(row[direction]),
        width: 22, height: y(0) - y(row[direction]), class: `bank-combined-bar bank-${direction}` });
      interactive(bar, description, row.month);
      bars.append(bar);
    }
    if (showBalance && previous !== null) lines.append(svgNode("line", { x1: x(previous.index), y1: y(previous.balance),
      x2: x(index), y2: y(row.balance), class: "bank-balance-line", "aria-hidden": "true" }));
    if (showBalance) {
      const point = svgNode("circle", { cx: x(index), cy: y(row.balance), r: 7, class: "bank-balance-point" });
      interactive(point, description, row.month);
      points.append(point);
    }
    previous = { index, balance: row.balance };
  }
  area.append(svg);
}

function renderItems() {
  const list = sortItems(filtered(), el("sort").value, el("category").value);
  el("details-result").textContent = `検索結果 ${list.length}件（${el("query").value.trim() ? `検索：${el("query").value.trim()} ／ ` : ""}上の期間・用途などの条件を適用）`;
  page = Math.min(Math.max(0, page), Math.max(0, Math.ceil(list.length / pageSize) - 1));
  el("items").replaceChildren();
  for (const item of list.slice(page * pageSize, (page + 1) * pageSize)) {
    const row = node("tr", undefined, needsAttention(item) ? "finance-review" : "");
    const memo = node("td", item.memo || "摘要なし");
    memo.append(node("small", item.note));
    const cell = node("td", `${item.category}${item.subcategory ? ` / ${item.subcategory}` : ""} / ${item.classified_by === "manual" ? "手動確定" : "分類候補"}`);
    if (item.allocations?.length) {
      for (const part of item.allocations) cell.append(node("small", `${part.category} / ${part.subcategory || "内訳なし"}：${formatYen(part.amount)}`));
    }
    cell.append(node("small", item.review_confirmed ? "確認済み" : item.review_reason));
    const edit = node("button", "分類修正", "secondary-btn");
    edit.type = "button";
    edit.disabled = busy;
    edit.onclick = () => item.allocations?.length ? openSplit(item) : openEdit([item]);
    cell.append(edit);
    const split = node("button", "内訳・分割", "secondary-btn");
    split.type = "button";
    split.disabled = busy;
    split.onclick = () => openSplit(item);
    cell.append(split);
    if (itemParts(item).every(part => part.category !== "未分類")) {
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
    const categoryDetails = node("details", undefined, "bank-category-details");
    categoryDetails.append(node("summary", "用途別の金額・割合"), scroll);
    part.append(categoryDetails);
    el("annual").append(part);
  }
  const breakdown = node("details"), heading = node("summary", "用途別の内訳金額");
  breakdown.append(heading);
  const detailRows = filterItems(allocatedItems(items), { account: el("account").value,
    from: analysis.period.start.slice(0, 7), to: analysis.period.end.slice(0, 7) })
    .filter(item => item.trade_date <= analysis.period.end);
  const groups = new Map();
  for (const item of detailRows) {
    const key = JSON.stringify([item.category, item.subcategory || "内訳なし"]);
    if (!groups.has(key)) groups.set(key, { category: item.category, subcategory: item.subcategory || "内訳なし", deposit: 0, withdrawal: 0 });
    const group = groups.get(key);
    group.deposit += item.deposit;
    group.withdrawal += item.withdrawal;
  }
  const scroll = node("div", undefined, "finance-scroll"), table = node("table"), head = node("tr");
  head.append(...["用途", "内訳", "入金", "出金"].map(label => node("th", label)));
  const thead = node("thead"), tbody = node("tbody");
  thead.append(head);
  for (const row of groups.values()) {
    const tr = node("tr");
    tr.append(node("td", row.category), node("td", row.subcategory), node("td", formatYen(row.deposit)), node("td", formatYen(row.withdrawal)));
    tbody.append(tr);
  }
  table.append(thead, tbody);
  scroll.tabIndex = 0;
  scroll.append(table);
  breakdown.append(scroll);
  el("annual").append(breakdown);
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
  pendingRule = null;
  editSelection = [];
  targets = [...selected];
  revisions = new Map(statements.map(record => [record.statement_id, record.revision]));
  el("edit-item").textContent = `${selected.length}件：${selected[0].memo || "摘要なし"}`;
  el("edit-category").value = selected[0].category;
  el("edit-subcategory").value = selected.length === 1 ? selected[0].subcategory || "" : "";
  el("edit-note").value = selected.length === 1 ? selected[0].note : "";
  el("edit-status").textContent = "";
  el("edit-confirm").checked = false;
  el("edit-save-rule").checked = false;
  el("edit-related").hidden = selected.length !== 1;
  editPrimary = selected.length === 1 ? selected[0] : null;
  el("edit-match").value = "";
  renderEditRelated();
  updateButtons();
  el("edit-dialog").showModal();
}

function renderEditRelated() {
  if (busy || editStarted) return;
  const primaryChecked = editSelection[0]?.checkbox.checked ?? true;
  editSelection = [];
  el("edit-related-items").replaceChildren();
  if (editPrimary) {
    const related = relatedItems(items, editPrimary, el("edit-match").value);
    el("edit-match-count").textContent = `追加候補：${related.length}件（追加対象は未選択です）`;
    for (const item of [editPrimary, ...related]) {
      const label = node("label", undefined, "bank-edit-choice"), checkbox = node("input");
      checkbox.type = "checkbox";
      checkbox.checked = item === editPrimary && primaryChecked;
      label.append(checkbox, node("span", `${item.trade_date} / ${item.memo || "摘要なし"} / ${item.deposit ? "入金" : "出金"} ${formatYen(item.deposit + item.withdrawal)} / ${item.category}${item.classified_by === "manual" ? "・手動修正済み" : ""}${item.review_confirmed ? "・確認済み" : ""}`));
      el("edit-related-items").append(label);
      editSelection.push({ item, checkbox });
    }
  }
}

function subcategoryChoices(input) {
  const panel = node("details", undefined, "bank-subcategory-choices");
  panel.append(node("summary", "内訳の候補から選ぶ"));
  const list = node("div", undefined, "bank-subcategory-list");
  list.setAttribute("role", "group");
  list.setAttribute("aria-label", "内訳の候補");
  for (const [category, values] of Object.entries(subcategories)) {
    list.append(node("h4", category));
    for (const value of values) {
      const button = node("button", value);
      button.type = "button";
      button.onclick = () => {
        if (busy || input.disabled) return;
        input.value = value;
        panel.open = false;
        input.focus();
      };
      list.append(button);
    }
  }
  panel.append(list);
  return panel;
}

function addSplitRow(part) {
  const row = node("div", undefined, "bank-split-row"), category = node("select"), detail = node("input"), amount = node("input");
  category.setAttribute("aria-label", "内訳の用途");
  for (const value of categories) {
    const option = node("option", value);
    option.value = value;
    category.append(option);
  }
  category.value = part.category;
  detail.value = part.subcategory;
  detail.maxLength = 80;
  detail.setAttribute("aria-label", "内訳名");
  detail.placeholder = "例：収入保険積立金";
  const detailField = node("div", undefined, "bank-subcategory-field");
  detailField.append(detail, subcategoryChoices(detail));
  amount.value = String(part.amount);
  amount.inputMode = "numeric";
  amount.setAttribute("aria-label", "内訳金額（円）");
  amount.placeholder = "整数円";
  const remove = node("button", "行を削除", "secondary-btn");
  remove.type = "button";
  const entry = { row, category, detail, amount };
  remove.onclick = () => {
    if (busy || splitSaved) return;
    splitRows = splitRows.filter(value => value !== entry);
    row.remove();
    updateSplitTotal();
  };
  amount.oninput = updateSplitTotal;
  row.append(category, detailField, amount, remove);
  splitRows.push(entry);
  el("split-rows").append(row);
}

function updateSplitTotal() {
  const total = splitRows.reduce((sum, entry) => sum + (/^\d+$/.test(entry.amount.value) ? Number(entry.amount.value) : 0), 0);
  const original = splitItem.deposit + splitItem.withdrawal;
  el("split-total").textContent = `内訳合計：${formatYen(total)} ／ 元の金額：${formatYen(original)} ／ 差額：${formatYen(original - total)}`;
}

function openSplit(item) {
  if (busy) return;
  splitItem = item;
  splitRevision = statements.find(record => record.statement_id === item.statement_id).revision;
  splitRows = [];
  splitSaved = false;
  el("split-item").textContent = `${item.trade_date} / ${item.memo || "摘要なし"} / ${item.deposit ? "入金" : "出金"} ${formatYen(item.deposit + item.withdrawal)}`;
  el("split-status").textContent = "";
  el("split-confirm").checked = false;
  el("split-rows").replaceChildren();
  for (const part of itemParts(item)) addSplitRow(part);
  updateSplitTotal();
  updateButtons();
  el("split-dialog").showModal();
}

async function saveSplit(event) {
  event.preventDefault();
  if (busy || splitSaved) return;
  let parts;
  try {
    parts = validateAllocations(splitRows.map(entry => ({
      category: entry.category.value, subcategory: entry.detail.value.trim(),
      amount: /^\d+$/.test(entry.amount.value) ? Number(entry.amount.value) : NaN,
    })), splitItem.deposit + splitItem.withdrawal);
    if (el("split-confirm").checked && parts.some(part => part.category === "未分類")) throw new Error("未分類を含む内訳は確認済みにできません。");
  } catch (error) {
    el("split-status").textContent = error.message;
    return;
  }
  await run(async () => {
    try {
      const result = await api("/classifications", { statement_id: splitItem.statement_id, transaction_id: splitItem.transaction_id,
        revision: splitRevision, allocations: parts, review_confirmed: el("split-confirm").checked });
      if (result.saved !== true || typeof result.revision !== "string") throw new Error("内訳の保存結果を確認できません。最新データを取得してください。");
      splitSaved = true;
      el("split-dialog").close();
      try { await loadData(); }
      catch (error) { throw new Error(`内訳は保存済みですが、表示更新に失敗しました。 ${error.message}`); }
      status("内訳を保存しました。口座の入出金額・残高は変更していません。");
      await showSaveResult("内訳を保存しました。");
    } catch (error) {
      el("split-status").textContent = `${error.message} 409の場合は閉じて最新データを取得してください。`;
      throw error;
    }
  });
}

async function saveEdit(event) {
  event.preventDefault();
  if (busy) return;
  if (!editStarted && editSelection.length) targets = editSelection.filter(choice => choice.checkbox.checked).map(choice => choice.item);
  if (!targets.length && !pendingRule) {
    el("edit-status").textContent = "保存する明細を選択してください。";
    return;
  }
  if (!editStarted && el("edit-save-rule").checked) {
    if (!editPrimary || !el("edit-match").value.trim() || el("edit-category").value === "未分類") {
      el("edit-status").textContent = "ルール保存には「摘要に含む文字」と未分類以外の用途を指定してください。";
      return;
    }
    pendingRule = { revision: ruleState.revision, account_id: editPrimary.account_id,
      direction: editPrimary.deposit ? "deposit" : "withdrawal", contains: el("edit-match").value.trim(),
      category: el("edit-category").value };
    pendingRule.subcategory = el("edit-subcategory").value.trim();
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
          ...(item.pendingReview ? { review_confirmed: true } : { category: el("edit-category").value,
            subcategory: el("edit-subcategory").value.trim(), note: item.editNote }) });
        if (result.saved !== true || typeof result.revision !== "string") throw new Error("分類の保存結果を確認できません。最新データを取得してください。");
        revisions.set(item.statement_id, result.revision);
        if (!item.pendingReview && el("edit-confirm").checked) {
          item.pendingReview = true;
          continue;
        }
        targets.shift();
        saved++;
      }
      if (pendingRule) {
        acceptRules(await api("/rules", pendingRule));
        pendingRule = null;
      }
    } catch (error) {
      el("edit-status").textContent = `${saved}件保存済み・残り${targets.length}件。${pendingRule ? "ルールは保存未確認です。" : ""}${targets[0]?.pendingReview ? "先頭の明細は分類保存済み・確認状態の保存待ちです。" : ""}${error.message} 409の場合は閉じて最新データを取得し、対象を選び直してください。`;
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
  for (const category of categories) for (const id of ["category", "edit-category", "rule-category"]) {
    if (id === "rule-category" && category === "未分類") continue;
    const option = node("option", category);
    option.value = category;
    el(id).append(option);
  }
  el("login").onclick = () => run(() => login("/bank/index.html"));
  el("refresh").onclick = () => run(async () => { status("最新データを取得しています…"); await loadData(); status("最新データを取得しました。"); });
  el("upload").onclick = () => run(uploadPdf);
  el("clear-filters").onclick = clearFilters;
  for (const id of ["account", "from", "to", "category", "subcategory", "direction", "query", "review-only", "sort"]) {
    el(id).addEventListener("input", () => { page = 0; render(); if (id === "account") { renderRecords(); renderRules(); } });
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
  el("chart-mode").onchange = render;
  el("details-query").oninput = () => setDetailsQuery(el("details-query").value);
  el("clear-details-query").onclick = () => setDetailsQuery("");
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
  for (const id of ["edit-subcategory", "rule-subcategory"]) {
    const input = el(id);
    input.parentElement.after(subcategoryChoices(input));
  }
  el("split-form").onsubmit = saveSplit;
  el("add-split").onclick = () => {
    if (busy || splitSaved) return;
    if (splitRows.length >= 30) { el("split-status").textContent = "内訳は30行までです。"; return; }
    addSplitRow({ category: "未分類", subcategory: "", amount: "" });
    updateSplitTotal();
  };
  el("cancel-split").onclick = () => el("split-dialog").close();
  el("split-dialog").addEventListener("cancel", event => { if (busy) event.preventDefault(); });
  el("rule-form").onsubmit = saveRule;
  el("cancel-rule").onclick = () => el("rule-dialog").close();
  el("rule-dialog").addEventListener("cancel", event => { if (busy) event.preventDefault(); });
  el("edit-match").oninput = renderEditRelated;
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
