import { verifyLocalAuth } from "/common/ui.js";
import { renderHeader } from "/common/header.js?v=1.1";
import { config } from "/photos/config.js";
import { clearSession, ensureToken, hasSession, login } from "/photos/auth.js?v=20261029-2";
import {
  applyAdjustments, buildCalendar, buildChecklist, computeCost, defaultScenarioIndex,
  editWarnings, fitRemaining, formatYen, personColorMap, shiftLabel, toInputTime, workHours,
} from "./shift-logic.js?v=20261030-32";

const element = (id) => document.getElementById(id);
let plan = null;
let calMode = "plan";
let editKey = null;
let editItem = null;
let workPlan = null;

// 作業計画（data/work-plan/<月>.json）の種別ラベル
const WORK_LABELS = {
  seed: "播種", nursery: "育苗", tillage: "耕起", weeding: "除草", "field-maintenance": "圃場整備",
  pesticide: "防除", fertilizer: "施肥", watering: "潅水", "hand-weeding": "手除草",
  intertill: "中耕", bedmaking: "畝立て", planting: "定植", harvest: "収穫", other: "他",
};

function currentScenario() {
  return plan.scenarios[Number(element("budget-slider").value)];
}

// 月ごとの編集データ（個別編集・基本時間帯・自動調整・チェック状態）。
// S3（shift/<月>/edits.json）に自動保存して端末間で共有。localStorageはオフライン時の控え。
let edits = { overrides: {}, base: null, autofit: false, checks: {} };
let pushTimer = null;

const cacheKey = () => `shift-edits:${plan.month}`;

function syncState(text) {
  element("sync-state").textContent = text;
}

function markDirty() {
  try { localStorage.setItem(cacheKey(), JSON.stringify(edits)); } catch { /* 容量超過などは無視 */ }
  syncState("☁ 保存中…");
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushEdits, 1500);
}

async function pushEdits() {
  try {
    await apiPost("/shift/edits", { month: plan.month, data: edits });
    syncState("☁ 保存済み");
  } catch (error) {
    console.warn("edits push failed", error);
    syncState("⚠ サーバー未保存（この端末には保存済み）");
  }
}

async function loadEdits() {
  edits = { overrides: {}, base: null, autofit: false, checks: {} };
  try {
    const result = await api("/shift/edits", { month: plan.month });
    Object.assign(edits, result.data || {});
    syncState("☁ 保存済み");
    return;
  } catch (error) {
    // 404 = まだ一度も保存していないだけ（正常）。それ以外のみ警告を残す。
    if (!String(error.message).includes("（404）")) console.warn("edits load failed", error);
  }
  // サーバーに無い場合：この端末の控え → 旧形式（移行）
  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey()));
    if (cached) {
      Object.assign(edits, cached);
      syncState("⚠ この端末の保存分（次の編集でサーバーへ保存）");
      return;
    }
  } catch { /* 破損時は無視 */ }
  const legacy = (name, fallback) => {
    try { return JSON.parse(localStorage.getItem(`shift-${name}:${plan.month}`)) ?? fallback; } catch { return fallback; }
  };
  edits.overrides = legacy("edit", {});
  edits.base = legacy("base", null);
  edits.autofit = legacy("autofit", false);
  edits.checks = legacy("check", {});
  syncState("");
}

function getOverrides() { return edits.overrides; }
function getBase() { return edits.base || { ...plan.targets.allday_default }; }
function baseChanged() {
  const base = getBase();
  const defaults = plan.targets.allday_default;
  return base.start !== defaults.start || base.end !== defaults.end;
}
function effective() {
  return applyAdjustments(plan, currentScenario(), getOverrides(), getBase());
}

// 画面に表示している実効アイテム（自動調整オン時は予算内への短縮も適用）
function displayedItems() {
  let eff = effective();
  if (edits.autofit) {
    eff = fitRemaining(plan, eff, currentScenario().budget_max, getBase()).items;
  }
  return eff;
}

function status(message, isError = false) {
  element("status").textContent = message;
  element("status").classList.toggle("error", isError);
}

async function api(path, query) {
  const token = await ensureToken();
  if (!token) throw new Error("ログインの期限が切れました。再ログインしてください。");
  const url = `${config.api}${path}${query ? `?${new URLSearchParams(query)}` : ""}`;
  const response = await fetch(url, { cache: "no-store", headers: { Authorization: `Bearer ${token}` } });
  return handleApiResponse(response);
}

async function apiPost(path, body) {
  const token = await ensureToken();
  if (!token) throw new Error("ログインの期限が切れました。再ログインしてください。");
  const response = await fetch(`${config.api}${path}`, {
    method: "POST", cache: "no-store",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  return handleApiResponse(response);
}

async function handleApiResponse(response) {
  if (response.status === 401) {
    clearSession();
    throw new Error("ログインをやり直してください。");
  }
  if (!response.ok) {
    let message = `シフトAPIでエラーが発生しました（${response.status}）。`;
    try {
      const parsed = await response.json();
      if (typeof parsed.message === "string") message += ` ${parsed.message}`;
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
    throw new Error(message);
  }
  return response.json();
}

function renderSummary(eff, computed) {
  const requests = plan.requests;
  const target = plan.targets;
  const days = eff.filter((item) => item.status !== "hold" && item.status !== "skip").length;
  element("summary-cards").innerHTML = [
    [`${target.person_days.min}〜${target.person_days.max}人日`, "目標（中心" + target.person_days.center + "）"],
    [`${requests.person_days}人日 / ${requests.person_hours}h`, "勤務希望の合計"],
    [formatYen(requests.cost_as_requested), "希望どおりの人件費"],
    [formatYen(computed.total), "案の人件費（交通費込み）"],
    [`${days}日`, "案の人日"],
  ].map(([value, label]) => `<div class="stat"><b>${value}</b><span>${label}</span></div>`).join("");
}

function renderAll() {
  const scenario = currentScenario();
  let eff = effective();
  let fitInfo = null;
  if (edits.autofit) {
    fitInfo = fitRemaining(plan, eff, scenario.budget_max, getBase());
    eff = fitInfo.items;
  }
  const computed = computeCost(eff, plan);
  const edited = eff.some((item) => item.edited) || baseChanged();
  const within = computed.total <= scenario.budget_max;
  element("budget-readout").innerHTML =
    `予算上限 ${formatYen(scenario.budget_max)} → 案 <span class="${within ? "ok" : "over"}">${formatYen(computed.total)}</span>` +
    (edited ? ` <span class="shift-muted">（自動案 ${formatYen(scenario.cost)}・編集あり）</span>` : "");

  const notes = [];
  const tierLabels = [["extra_others", "追加（優先以外）"], ["extra_protected", "追加（優先）"],
                      ["fixed_others", "決まった曜日（優先以外）"], ["fixed_protected", "決まった曜日（優先）"]];
  const capNote = (caps) => tierLabels
    .filter(([key]) => caps[key] !== undefined && caps[key] < plan.targets.max_work_hours)
    .map(([key, label]) => `${label} ${caps[key]}h以内`).join(" / ");
  if (scenario.adjusted_for_budget) {
    const caps = scenario.caps_hours || {};
    const message = "others" in caps
      ? `優先する人以外 ${caps.others}h以内 / 優先する人 ${caps.protected}h以内`
      : capNote(caps);
    if (message) notes.push(`予算に収めるため時間を調整：${message}（追加の希望日から先に短縮・第6条①）`);
    if (scenario.held_for_budget_days > 0) notes.push(`予算のため追加の希望日 ${scenario.held_for_budget_days}日 を保留（第6条②）`);
  }
  if (scenario.needs_fixed_weekday_consult) {
    notes.push("⚠ 下限まで短くしても予算に収まりません。決まった曜日の削減を本人と相談してください（要同意）。");
  }
  if (fitInfo) {
    if (fitInfo.over) {
      notes.push("⚠ 自動調整：未編集の日を下限まで短くしても予算に収まりません。編集した日を見直すか、見送りを増やしてください。");
    } else {
      const message = capNote(fitInfo.caps);
      if (message) notes.push(`自動調整：編集した日を優先し、${message} に短縮しています（追加の希望日から先）`);
    }
  }
  // timetree上は「確定」か「希」の2状態。希（目安＋保留）の確定/見送りで出る人件費の幅をバーで示す
  const pending = eff.filter((item) => item.status === "extra" || item.status === "hold");
  if (pending.length) {
    const minTotal = computeCost(eff.filter((item) => item.status === "fixed"), plan).total;
    const merged = { ...getOverrides() };
    for (const item of pending) merged[item.key] = { ...(merged[item.key] || {}), status: "extra" };
    const maxTotal = computeCost(applyAdjustments(plan, scenario, merged, getBase()), plan).total;
    renderCostRange(minTotal, computed.total, maxTotal, scenario.budget_max, pending.length);
  } else {
    element("cost-range").innerHTML = "";
  }
  element("scenario-notes").innerHTML =
    notes.map((n) => `<p class="note${n.startsWith("⚠") ? " warn" : ""}">${n}</p>`).join("");
  element("base-note").textContent = (() => {
    const base = getBase();
    const hours = workHours(base.start, base.end, plan.targets.break_minutes);
    return hours === null ? "" : `（この枠の実働 ${hours}h）`;
  })();

  renderSummary(eff, computed);
  renderCalendar(eff);
  renderPersons(computed, eff);
  renderChecklist(eff);
}

// 人件費の幅（見送り時〜全確定時）をミニバーで表示する
function renderCostRange(minTotal, planTotal, maxTotal, budgetMax, pendingCount) {
  const lo = Math.min(minTotal, budgetMax) * 0.98;
  const hi = Math.max(maxTotal, budgetMax) * 1.02;
  const pos = (value) => Math.max(0, Math.min(100, ((value - lo) / (hi - lo)) * 100));
  const over = maxTotal > budgetMax;
  const bandEnd = over ? pos(budgetMax) : pos(maxTotal);
  const overBand = over
    ? `<div class="range-band over" style="left:${pos(budgetMax)}%;width:${pos(maxTotal) - pos(budgetMax)}%"></div>` : "";
  element("cost-range").innerHTML =
    `<div class="range-title">人件費の幅（「希」${pendingCount}日の確定/見送りで変動）${over ? "　⚠全て確定すると予算超過" : ""}</div>` +
    `<div class="range-bar">` +
      `<div class="range-band" style="left:${pos(minTotal)}%;width:${bandEnd - pos(minTotal)}%"></div>` + overBand +
      `<div class="range-mark budget" style="left:${pos(budgetMax)}%" title="予算上限 ${formatYen(budgetMax)}"></div>` +
      `<div class="range-mark plan" style="left:${pos(planTotal)}%" title="案 ${formatYen(planTotal)}"></div>` +
    `</div>` +
    `<div class="range-legend">` +
      `<span>見送り ${formatYen(minTotal)}</span>` +
      `<span class="plan">● 案 ${formatYen(planTotal)}</span>` +
      `<span${over ? ' class="over"' : ""}>全確定 ${formatYen(maxTotal)}</span>` +
      `<span class="budget">｜予算上限 ${formatYen(budgetMax)}</span>` +
    `</div>`;
}

function renderCalendar(eff) {
  const colors = personColorMap(plan.staff);
  const base = getBase();
  const rawItems = Array.isArray(plan.requests.items) ? plan.requests.items : null;
  const rawRadio = element("cal-mode-raw");
  rawRadio.disabled = !rawItems;
  rawRadio.title = rawItems ? "" : "この月の plan.json には原本データがありません（再生成が必要）";
  const mode = calMode === "raw" && rawItems ? "raw" : "plan";

  const personLegend = plan.staff.map((member) =>
    `<span class="legend person"><i style="background:${colors.get(member.name)}"></i>${member.name}</span>`).join("");
  element("legend").innerHTML = mode === "raw"
    ? personLegend + '<span class="legend kind">timetreeの希望タイトルをそのまま表示（⚠=要確認の注記あり）</span>'
    : personLegend +
      '<span class="legend kind"><i class="sample-fixed"></i>確定（「希」を外す）</span>' +
      '<span class="legend kind"><i class="sample-extra"></i>確定の目安（「希」のまま）</span>' +
      '<span class="legend kind"><i class="sample-hold"></i>保留（「希」のまま・判断待ち）</span>' +
      '<span class="legend kind"><i class="sample-skip"></i>見送り</span>' +
      '<span class="legend kind">✎=編集済み・⚠=制約/希望と食い違い・クリックで個別調整</span>';

  const weeks = buildCalendar(plan.month, mode === "raw" ? rawItems : eff);
  const head = ["月", "火", "水", "木", "金", "土", "日"]
    .map((w) => `<th class="${w === "土" ? "sat" : w === "日" ? "sun" : ""}">${w}</th>`).join("");
  const rows = weeks.map((week) => `<tr>${week.map((cell) => {
    if (!cell) return '<td class="empty"></td>';
    const works = workPlan?.days?.[cell.date] || [];
    let workTags = "";
    if (works.length) {
      const counts = new Map();
      for (const w of works) counts.set(w.type, (counts.get(w.type) || 0) + 1);
      const text = [...counts.entries()]
        .map(([type, count]) => `${WORK_LABELS[type] || type}${count > 1 ? `×${count}` : ""}`).join("・");
      const title = works.map((w) => `${WORK_LABELS[w.type] || w.type}${w.note ? "：" + w.note : ""}`).join("、");
      workTags = `<div class="wp-tags" title="${title.replace(/"/g, "&quot;")}">${text}</div>`;
    }
    const chips = cell.items.map((item) => {
      const color = colors.get(item.person) || "#757575";
      if (mode === "raw") {
        const warn = item.warnings ? "⚠" : "";
        const title = `${item.person}: ${item.raw_title}${item.warnings ? "／" + item.warnings : ""}`;
        return `<span class="chip raw" style="background:${color}" title="${title}">${warn}${item.raw_title}</span>`;
      }
      const kind = item.status;
      const warnings = kind === "hold" || kind === "skip" ? []
        : editWarnings(plan, item, kind, item.start, item.proposed_end, eff);
      const mark = `${warnings.length ? "⚠" : ""}${item.edited ? "✎" : item.autoCut ? "↓" : ""}`;
      const span = kind !== "hold" && kind !== "skip" ? shiftLabel(item.start, item.proposed_end, base) : "";
      const amount = span || (kind !== "hold" && kind !== "skip" && item.proposed_hours > 0 ? `${item.proposed_hours}h` : "");
      const prefix = kind === "extra" || kind === "hold" ? "希 " : "";
      const text = `${mark}${prefix}${item.person}${amount ? " " + amount : ""}`;
      const style = kind === "fixed" ? `background:${color}`
        : kind === "extra" ? `color:${color};border-color:${color}` : "";
      const time = item.start && item.proposed_end ? `${item.start}〜${item.proposed_end}・` : "";
      const warnText = warnings.length ? `／⚠${warnings.join("、")}` : "";
      return `<span class="chip ${kind} clickable${warnings.length ? " warned" : ""}" style="${style}" data-key="${item.key}" ` +
        `title="${item.raw_title}（${time}実働${item.proposed_hours}h・${item.action}${item.reason ? "：" + item.reason : ""}${warnText}）クリックで調整">${text}</span>`;
    }).join("");
    return `<td><span class="day-no">${cell.day}</span>${workTags}${chips}</td>`;
  }).join("")}</tr>`).join("");
  element("calendar").innerHTML = `<table class="shift-cal"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

function renderPersons(computed, eff) {
  // 人別・状態別の日数内訳
  const breakdown = new Map();
  for (const item of eff) {
    if (!breakdown.has(item.person)) breakdown.set(item.person, { fixed: 0, extra: 0, hold: 0, skip: 0 });
    breakdown.get(item.person)[item.status] += 1;
  }
  const detail = (b) => {
    if (!b) return "";
    const parts = [`確定${b.fixed}`, `希${b.extra}`];
    if (b.hold) parts.push(`保留${b.hold}`);
    if (b.skip) parts.push(`見送${b.skip}`);
    return `<span class="shift-breakdown">${parts.join("・")}</span>`;
  };
  const rows = plan.staff.map((member) => {
    const row = computed.perPerson[member.name] || { days: 0, hours: 0, cost: 0 };
    return { name: member.name, protected: !!member.protected, target: member.target_days ?? null,
             b: breakdown.get(member.name), ...row };
  });
  const totalDays = rows.reduce((sum, row) => sum + row.days, 0);
  const totalCost = rows.reduce((sum, row) => sum + row.cost, 0);
  const totalB = { fixed: 0, extra: 0, hold: 0, skip: 0 };
  for (const b of breakdown.values()) {
    totalB.fixed += b.fixed; totalB.extra += b.extra; totalB.hold += b.hold; totalB.skip += b.skip;
  }
  element("person-table").innerHTML =
    "<tr><th>名前</th><th>予定日数（内訳）</th><th>目安日数</th><th>人時</th><th>人件費</th><th></th></tr>" +
    rows.map((row) =>
      `<tr><td>${row.name}${row.protected ? "（優先）" : ""}</td>` +
      `<td>${row.days}日${detail(row.b)}</td>` +
      `<td>${row.target ?? "-"}日</td><td>${row.hours}h</td><td>${formatYen(row.cost)}</td>` +
      `<td><button type="button" class="secondary-btn bulk-btn" data-person="${row.name}">一括編集</button></td></tr>`).join("") +
    `<tr class="total"><td>合計</td><td>${totalDays}日${detail(totalB)}</td><td></td><td></td><td>${formatYen(totalCost)}</td><td></td></tr>`;
  element("person-table").querySelectorAll(".bulk-btn").forEach((button) => {
    button.addEventListener("click", () => openBulk(button.dataset.person));
  });
}

// ───── 人ごとの一括編集 ─────
let bulkPerson = null;

function bulkTargets() {
  return [...document.querySelectorAll("#bulk-dialog .bulk-targets input:checked")].map((box) => box.value);
}

function bulkMatches() {
  const targets = bulkTargets();
  return displayedItems().filter((item) => item.person === bulkPerson && targets.includes(item.status));
}

function updateBulkInfo() {
  const matches = bulkMatches();
  const hours = workHours(element("bulk-start").value, element("bulk-end").value, plan.targets.break_minutes);
  let text = `対象: ${matches.length}日`;
  if (hours !== null) text += ` ／ 実働 ${hours}h（休憩は自動計算）`;
  element("bulk-info").textContent = text;
}

function openBulk(person) {
  bulkPerson = person;
  element("bulk-title").textContent = `${person} の一括編集（${plan.month}）`;
  element("bulk-status").value = "";
  element("bulk-start").value = "";
  element("bulk-end").value = "";
  updateBulkInfo();
  element("bulk-dialog").showModal();
}

function applyBulk() {
  const status = element("bulk-status").value;
  const start = element("bulk-start").value;
  const end = element("bulk-end").value;
  if (!status && !start && !end) {
    element("bulk-info").textContent = "変更する内容（状態または時刻）を選んでください。";
    return;
  }
  const matches = bulkMatches();
  if (!matches.length) {
    element("bulk-info").textContent = "対象の日がありません。";
    return;
  }
  const hours = workHours(start, end, plan.targets.break_minutes);
  const overrides = getOverrides();
  const warns = new Set();
  for (const item of matches) {
    const override = { ...(overrides[item.key] || {}) };
    override.status = status || item.status;
    if (start) override.start = start;
    if (end) override.end = end;
    if (hours !== null) override.hours = hours;
    overrides[item.key] = override;
    for (const warning of editWarnings(plan, item, override.status,
                                       start || item.start, end || item.proposed_end, displayedItems())) {
      warns.add(warning);
    }
  }
  markDirty();
  element("bulk-dialog").close();
  renderAll();
  status(`✎ ${bulkPerson} の ${matches.length}日 にまとめて反映しました。` +
    (warns.size ? ` ⚠ ${[...warns].join("／")}` : ""), warns.size > 0);
}

function clearBulk() {
  if (!confirm(`${bulkPerson} さんの個別編集をすべて取り消しますか？`)) return;
  const overrides = getOverrides();
  for (const key of Object.keys(overrides)) {
    if (key.endsWith(`:${bulkPerson}`)) delete overrides[key];
  }
  markDirty();
  element("bulk-dialog").close();
  renderAll();
  status(`${bulkPerson} さんの編集を取り消しました。`);
}

let checklistPerson = "";

function renderChecklist(eff) {
  const groups = buildChecklist({ items: eff });
  const saved = edits.checks;
  const names = plan.staff.map((member) => member.name);
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const deadlineOf = (date) => {
    const [y, m, d] = date.split("-").map(Number);
    const deadline = new Date(Date.UTC(y, m - 1, d - 3));
    return `${deadline.getUTCFullYear()}-${String(deadline.getUTCMonth() + 1).padStart(2, "0")}-${String(deadline.getUTCDate()).padStart(2, "0")}`;
  };
  const deadlineBadge = (date) => {
    const deadline = deadlineOf(date);
    const urgent = deadline <= todayIso;
    return `<span class="check-deadline${urgent ? " urgent" : ""}">期限 ${Number(deadline.slice(5, 7))}/${Number(deadline.slice(8, 10))}</span>`;
  };

  const section = (title, list, hint, withDeadline) => {
    const filtered = list.filter((item) => !checklistPerson || item.person === checklistPerson);
    if (!filtered.length) return "";
    const done = filtered.filter((item) => saved[item.id]).length;
    const rows = [...filtered]
      .sort((a, b) => (saved[a.id] ? 1 : 0) - (saved[b.id] ? 1 : 0) || a.date.localeCompare(b.date))
      .map((item) => {
        const amount = item.time || (item.hours > 0 ? `${item.hours}h` : "");
        return `<label class="${saved[item.id] ? "done" : ""}" title="${item.label.replace(/"/g, "&quot;")}">` +
          `<input type="checkbox" data-id="${item.id}"${saved[item.id] ? " checked" : ""}>` +
          `<span><b>${item.md}(${item.weekday})</b> ${item.person}` +
          `${amount ? ` <span class="check-time">${amount}</span>` : ""}` +
          `${item.extra ? ` <span class="check-extra">${item.extra}</span>` : ""}` +
          `${withDeadline && !saved[item.id] ? " " + deadlineBadge(item.date) : ""}</span></label>`;
      }).join("");
    return `<details open><summary>${title} <span class="check-progress${done === filtered.length ? " all" : ""}">${done}/${filtered.length}</span>` +
      `<span class="check-hint">${hint}</span></summary>${rows}</details>`;
  };

  const filterBar = `<div class="check-filter">` +
    ["", ...names].map((name) =>
      `<button type="button" class="check-person${checklistPerson === name ? " on" : ""}" data-person="${name}">${name || "全員"}</button>`
    ).join("") + `</div>`;

  const body =
    section("① 月末までに確定（決まった曜日）", groups.fixed, "timetreeで「希」を外す（具体的な時間は前日のLINEで）", false) +
    section("② 勤務3日前までに確定（追加の希望日）", groups.extra, "確定するなら連絡して「希」を外す。見送りなら連絡", true) +
    section("③ 保留（判断待ち・「希」のまま）", groups.hold, "作業量が決まり次第、期限までに確定か見送りを連絡", true) +
    section("④ 見送り", groups.skip, "見送りと連絡（月末の編集でまとめてOK・timetreeの「希」はそのまま）", false);
  element("checklist").innerHTML = filterBar + (body || "<p>項目がありません。</p>");

  element("checklist").querySelectorAll(".check-person").forEach((button) => {
    button.addEventListener("click", () => {
      checklistPerson = button.dataset.person;
      renderChecklist(displayedItems());
    });
  });
  element("checklist").querySelectorAll("input[type=checkbox]").forEach((box) => {
    box.addEventListener("change", () => {
      saved[box.dataset.id] = box.checked;
      markDirty();
      renderChecklist(displayedItems());
    });
  });
}

// ───── 個別編集ダイアログ ─────
function updateEditHours() {
  const status = element("edit-status").value;
  const constraintWarns = editItem
    ? editWarnings(plan, editItem, status, element("edit-start").value, element("edit-end").value, displayedItems())
    : [];
  element("edit-warn").innerHTML = constraintWarns.map((w) => `<span>⚠ ${w}</span>`).join("<br>");
  if (status === "hold") {
    element("edit-hours").textContent = "保留（0h・人件費に含めない。「希」のまま判断待ち）";
    return;
  }
  if (status === "skip") {
    element("edit-hours").textContent = "見送り（0h・人件費に含めない。本人へ連絡）";
    return;
  }
  const hours = workHours(element("edit-start").value, element("edit-end").value, plan.targets.break_minutes);
  if (hours === null) {
    element("edit-hours").textContent = "実働: 時間未入力（自動計算の値のまま）";
    return;
  }
  let text = `実働 ${hours}h（休憩は自動計算）`;
  if (hours > plan.targets.max_work_hours) text += ` ⚠上限${plan.targets.max_work_hours}h超（繁忙期の同意が必要）`;
  else if (hours < plan.targets.min_work_hours) text += ` ⚠下限${plan.targets.min_work_hours}h未満`;
  element("edit-hours").textContent = text;
}

function openEditor(key) {
  editKey = key;
  const item = displayedItems().find((entry) => entry.key === key);
  if (!item) return;
  editItem = item;
  element("edit-title").textContent =
    `${Number(item.date.slice(5, 7))}/${Number(item.date.slice(8, 10))}(${item.weekday}) ${item.person}`;
  element("edit-sub").textContent = `希望の原本: ${item.raw_title}（希望 実働${item.request_hours}h）`;
  element("edit-status").value = item.status;
  element("edit-start").value = toInputTime(item.start);
  element("edit-end").value = toInputTime(item.proposed_end || item.end);
  updateEditHours();
  element("edit-dialog").showModal();
}

function saveEdit() {
  const overrides = getOverrides();
  const start = element("edit-start").value;
  const end = element("edit-end").value;
  const override = { status: element("edit-status").value };
  if (start) override.start = start;
  if (end) override.end = end;
  const hours = workHours(start, end, plan.targets.break_minutes);
  if (hours !== null) override.hours = hours;
  overrides[editKey] = override;
  markDirty();
  element("edit-dialog").close();
  renderAll();
}

function clearEdit() {
  const overrides = getOverrides();
  delete overrides[editKey];
  markDirty();
  element("edit-dialog").close();
  renderAll();
}

function renderIssues() {
  element("issues").innerHTML = (plan.issues.length ? plan.issues : ["問題は見つかりませんでした"])
    .map((issue) => `<li>${issue}</li>`).join("");
}

async function loadPlan(month) {
  status("読み込み中…");
  plan = await api("/shift/plan", month ? { month } : undefined);
  const slider = element("budget-slider");
  slider.max = plan.scenarios.length - 1;
  slider.value = defaultScenarioIndex(plan);
  await loadEdits();
  workPlan = await fetch(`/data/work-plan/${plan.month}.json?ts=${Date.now()}`, { cache: "no-store" })
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null);
  element("work-plan-link").href = `/schedule/work-plan/index.html?ym=${plan.month}`;
  const base = getBase();
  element("base-start").value = toInputTime(base.start);
  element("base-end").value = toInputTime(base.end);
  element("auto-fit").checked = edits.autofit;
  element("generated-at").textContent =
    `作成: ${plan.generated_at.replace("T", " ").slice(0, 16)} / 希望 ${plan.requests.entries}件`;
  renderAll();
  renderIssues();
  element("plan-area").hidden = false;
  status("");
}

async function loadMonths() {
  try {
    const result = await api("/shift/months");
    const select = element("month-select");
    select.innerHTML = result.months.map((m) => `<option value="${m}">${m}</option>`).join("");
    if (plan && result.months.includes(plan.month)) select.value = plan.month;
  } catch (error) {
    console.warn("months load failed", error);
  }
}

async function start() {
  try {
    await loadPlan();
    await loadMonths();
  } catch (error) {
    if (!hasSession()) {
      element("login-area").hidden = false;
      status("");
      return;
    }
    status(error.message, true);
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  const ok = await verifyLocalAuth();
  if (!ok) return;
  if (!["admin", "family"].includes(window.currentRole)) {
    alert("このページは admin / family のみアクセスできます");
    location.href = "/index.html";
    return;
  }
  renderHeader({ adminPage: true });
  element("page-area").hidden = false;

  element("login").addEventListener("click", () => login("/admin/shift/index.html"));
  element("budget-slider").addEventListener("input", () => renderAll());
  document.querySelectorAll('input[name="cal-mode"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      calMode = radio.value;
      renderCalendar(displayedItems());
    });
  });
  element("month-select").addEventListener("change", (event) => {
    loadPlan(event.target.value).catch((error) => status(error.message, true));
  });
  element("regen").addEventListener("click", async () => {
    if (!plan) return;
    if (!confirm(`${plan.month} のシフト案を timetree の最新データで再計算しますか？（約1分）`)) return;
    try {
      element("regen").disabled = true;
      await apiPost("/shift/regenerate", { month: plan.month });
      status(`🔄 ${plan.month} を再計算中…（約30秒後に自動で読み直します）`);
      setTimeout(() => {
        loadPlan(plan.month)
          .then(() => status("再計算した案を読み込みました。"))
          .catch((error) => status(error.message, true))
          .finally(() => { element("regen").disabled = false; });
      }, 30000);
    } catch (error) {
      element("regen").disabled = false;
      status(error.message, true);
    }
  });
  element("calendar").addEventListener("click", (event) => {
    const chip = event.target.closest(".chip[data-key]");
    if (chip) openEditor(chip.dataset.key);
  });
  for (const id of ["base-start", "base-end"]) {
    element(id).addEventListener("change", () => {
      edits.base = { start: element("base-start").value, end: element("base-end").value };
      markDirty();
      renderAll();
    });
  }
  element("auto-fit").addEventListener("change", (event) => {
    edits.autofit = event.target.checked;
    markDirty();
    renderAll();
  });
  element("reset-edits").addEventListener("click", () => {
    if (!confirm("この月の個別編集と基本時間帯の変更をすべてリセットしますか？")) return;
    edits.overrides = {};
    edits.base = null;
    markDirty();
    const defaults = plan.targets.allday_default;
    element("base-start").value = toInputTime(defaults.start);
    element("base-end").value = toInputTime(defaults.end);
    renderAll();
  });
  element("edit-status").addEventListener("change", updateEditHours);
  element("edit-start").addEventListener("input", updateEditHours);
  element("edit-end").addEventListener("input", updateEditHours);
  document.querySelectorAll("#edit-dialog [data-quick]").forEach((button) => {
    button.addEventListener("click", () => {
      const base = getBase();
      const quick = button.dataset.quick;
      element("edit-start").value = toInputTime(quick === "pm" ? "13:00" : base.start);
      element("edit-end").value = toInputTime(quick === "am" ? "12:00" : base.end);
      const current = element("edit-status").value;
      if (current === "hold" || current === "skip") element("edit-status").value = "fixed";
      updateEditHours();
    });
  });
  element("edit-save").addEventListener("click", saveEdit);
  element("edit-clear").addEventListener("click", clearEdit);
  element("edit-cancel").addEventListener("click", () => element("edit-dialog").close());
  element("bulk-apply").addEventListener("click", applyBulk);
  element("bulk-clear").addEventListener("click", clearBulk);
  element("bulk-cancel").addEventListener("click", () => element("bulk-dialog").close());
  document.querySelectorAll("#bulk-dialog .bulk-targets input").forEach((box) =>
    box.addEventListener("change", updateBulkInfo));
  element("bulk-start").addEventListener("input", updateBulkInfo);
  element("bulk-end").addEventListener("input", updateBulkInfo);
  document.querySelectorAll("#bulk-dialog [data-bulk-quick]").forEach((button) => {
    button.addEventListener("click", () => {
      const base = getBase();
      const quick = button.dataset.bulkQuick;
      element("bulk-start").value = toInputTime(quick === "pm" ? "13:00" : base.start);
      element("bulk-end").value = toInputTime(quick === "am" ? "12:00" : base.end);
      updateBulkInfo();
    });
  });

  if (!hasSession()) {
    element("login-area").hidden = false;
    return;
  }
  await start();
});
