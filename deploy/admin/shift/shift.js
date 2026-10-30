import { verifyLocalAuth } from "/common/ui.js";
import { renderHeader } from "/common/header.js?v=1.1";
import { config } from "/photos/config.js";
import { clearSession, ensureToken, hasSession, login } from "/photos/auth.js?v=20261029-2";
import {
  WEEKDAYS, buildCalendar, buildChecklist, defaultScenarioIndex,
  formatYen, itemKind, personColorMap, personRows, scenarioBudgets,
} from "./shift-logic.js?v=20261030-2";

const element = (id) => document.getElementById(id);
let plan = null;

function status(message, isError = false) {
  element("status").textContent = message;
  element("status").classList.toggle("error", isError);
}

async function api(path, query) {
  const token = await ensureToken();
  if (!token) throw new Error("ログインの期限が切れました。再ログインしてください。");
  const url = `${config.api}${path}${query ? `?${new URLSearchParams(query)}` : ""}`;
  const response = await fetch(url, { cache: "no-store", headers: { Authorization: `Bearer ${token}` } });
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

function renderSummary(scenario) {
  const requests = plan.requests;
  const target = plan.targets;
  element("summary-cards").innerHTML = [
    [`${target.person_days.min}〜${target.person_days.max}人日`, "目標（中心" + target.person_days.center + "）"],
    [`${requests.person_days}人日 / ${requests.person_hours}h`, "勤務希望の合計"],
    [formatYen(requests.cost_as_requested), "希望どおりの人件費"],
    [formatYen(scenario.cost), "案の人件費（交通費込み）"],
    [`${scenario.items.filter((i) => itemKind(i) !== "hold").length}日`, "案の人日"],
  ].map(([value, label]) => `<div class="stat"><b>${value}</b><span>${label}</span></div>`).join("");
}

function renderScenario() {
  const index = Number(element("budget-slider").value);
  const scenario = plan.scenarios[index];
  const within = scenario.cost <= scenario.budget_max;
  element("budget-readout").innerHTML =
    `予算上限 ${formatYen(scenario.budget_max)} → 案 <span class="${within ? "ok" : "over"}">${formatYen(scenario.cost)}</span>`;

  const notes = [];
  if (scenario.adjusted_for_budget) {
    const caps = scenario.caps_hours;
    notes.push(`予算に収めるため時間を調整：優先する人以外 ${caps.others}h以内 / 優先する人 ${caps.protected}h以内（第6条①）`);
    if (scenario.held_for_budget_days > 0) notes.push(`予算のため追加の希望日 ${scenario.held_for_budget_days}日 を保留（第6条②）`);
  }
  if (scenario.needs_fixed_weekday_consult) {
    notes.push("⚠ 下限まで短くしても予算に収まりません。決まった曜日の削減を本人と相談してください（要同意）。");
  }
  element("scenario-notes").innerHTML =
    notes.map((n) => `<p class="note${n.startsWith("⚠") ? " warn" : ""}">${n}</p>`).join("");

  renderSummary(scenario);
  renderCalendar(scenario);
  renderPersons(scenario);
  renderChecklist(scenario);
}

function renderCalendar(scenario) {
  const colors = personColorMap(plan.staff);
  element("legend").innerHTML =
    plan.staff.map((member) =>
      `<span class="legend person"><i style="background:${colors.get(member.name)}"></i>${member.name}</span>`).join("") +
    '<span class="legend kind"><i class="sample-fixed"></i>確定（「希」を外す）</span>' +
    '<span class="legend kind"><i class="sample-extra"></i>確定の目安（「希」のまま）</span>' +
    '<span class="legend kind"><i class="sample-hold"></i>保留・見送り</span>';

  const weeks = buildCalendar(plan.month, scenario.items);
  const head = ["月", "火", "水", "木", "金", "土", "日"]
    .map((w) => `<th class="${w === "土" ? "sat" : w === "日" ? "sun" : ""}">${w}</th>`).join("");
  const rows = weeks.map((week) => `<tr>${week.map((cell) => {
    if (!cell) return '<td class="empty"></td>';
    const chips = cell.items.map((item) => {
      const kind = itemKind(item);
      const color = colors.get(item.person) || "#757575";
      const hours = item.proposed_hours > 0 ? ` ${item.proposed_hours}h` : "";
      const text = kind === "extra" ? `希 ${item.person}${hours}` : `${item.person}${hours}`;
      const style = kind === "fixed" ? `background:${color}`
        : kind === "extra" ? `color:${color};border-color:${color}` : "";
      return `<span class="chip ${kind}" style="${style}" title="${item.raw_title}（${item.action}${item.reason ? "：" + item.reason : ""}）">${text}</span>`;
    }).join("");
    return `<td><span class="day-no">${cell.day}</span>${chips}</td>`;
  }).join("")}</tr>`).join("");
  element("calendar").innerHTML = `<table class="shift-cal"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

function renderPersons(scenario) {
  const rows = personRows(plan, scenario);
  const totalDays = rows.reduce((sum, row) => sum + row.days, 0);
  const totalCost = rows.reduce((sum, row) => sum + row.cost, 0);
  element("person-table").innerHTML =
    "<tr><th>名前</th><th>予定日数</th><th>目安日数</th><th>人件費</th></tr>" +
    rows.map((row) =>
      `<tr><td>${row.name}${row.protected ? "（優先）" : ""}</td><td>${row.days}日</td>` +
      `<td>${row.target ?? "-"}日</td><td>${formatYen(row.cost)}</td></tr>`).join("") +
    `<tr class="total"><td>合計</td><td>${totalDays}日</td><td></td><td>${formatYen(totalCost)}</td></tr>`;
}

function renderChecklist(scenario) {
  const groups = buildChecklist(scenario);
  const storageKey = `shift-check:${plan.month}`;
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(storageKey)) || {}; } catch { saved = {}; }
  const section = (title, list) => !list.length ? "" :
    `<h3>${title}</h3>` + list.map((item) =>
      `<label class="${saved[item.id] ? "done" : ""}"><input type="checkbox" data-id="${item.id}"${saved[item.id] ? " checked" : ""}><span>${item.label}</span></label>`
    ).join("");
  element("checklist").innerHTML =
    section("① 月末までに確定（決まった曜日）", groups.fixed) +
    section("② 勤務3日前までに確定（追加の希望日）", groups.extra) +
    section("③ 保留・見送り（作業量が決まってから判断）", groups.hold) || "<p>項目がありません。</p>";
  element("checklist").querySelectorAll("input[type=checkbox]").forEach((box) => {
    box.addEventListener("change", () => {
      saved[box.dataset.id] = box.checked;
      localStorage.setItem(storageKey, JSON.stringify(saved));
      box.closest("label").classList.toggle("done", box.checked);
    });
  });
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
  element("generated-at").textContent =
    `作成: ${plan.generated_at.replace("T", " ").slice(0, 16)} / 希望 ${plan.requests.entries}件`;
  renderScenario();
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
  element("budget-slider").addEventListener("input", renderScenario);
  element("month-select").addEventListener("change", (event) => {
    loadPlan(event.target.value).catch((error) => status(error.message, true));
  });

  if (!hasSession()) {
    element("login-area").hidden = false;
    return;
  }
  await start();
});
