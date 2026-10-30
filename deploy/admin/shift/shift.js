import { verifyLocalAuth } from "/common/ui.js";
import { renderHeader } from "/common/header.js?v=1.1";
import { config } from "/photos/config.js";
import { clearSession, ensureToken, hasSession, login } from "/photos/auth.js?v=20261029-2";
import {
  applyAdjustments, buildCalendar, buildChecklist, computeCost, defaultScenarioIndex,
  fitRemaining, formatYen, personColorMap, toInputTime, workHours,
} from "./shift-logic.js?v=20261030-7";

const element = (id) => document.getElementById(id);
let plan = null;
let calMode = "plan";
let editKey = null;

function currentScenario() {
  return plan.scenarios[Number(element("budget-slider").value)];
}

// 月ごとの端末ローカル保存（編集・基本時間帯・チェック状態）
const storeName = (name) => `shift-${name}:${plan.month}`;
function loadStore(name, fallback) {
  try { return JSON.parse(localStorage.getItem(storeName(name))) ?? fallback; } catch { return fallback; }
}
function saveStore(name, value) { localStorage.setItem(storeName(name), JSON.stringify(value)); }

function getOverrides() { return loadStore("edit", {}); }
function getBase() { return loadStore("base", null) || { ...plan.targets.allday_default }; }
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
  if (loadStore("autofit", false)) {
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
  const days = eff.filter((item) => item.status !== "hold").length;
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
  if (loadStore("autofit", false)) {
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
  if (scenario.adjusted_for_budget) {
    const caps = scenario.caps_hours;
    notes.push(`予算に収めるため時間を調整：優先する人以外 ${caps.others}h以内 / 優先する人 ${caps.protected}h以内（第6条①）`);
    if (scenario.held_for_budget_days > 0) notes.push(`予算のため追加の希望日 ${scenario.held_for_budget_days}日 を保留（第6条②）`);
  }
  if (scenario.needs_fixed_weekday_consult) {
    notes.push("⚠ 下限まで短くしても予算に収まりません。決まった曜日の削減を本人と相談してください（要同意）。");
  }
  if (fitInfo) {
    const mx = plan.targets.max_work_hours;
    if (fitInfo.over) {
      notes.push("⚠ 自動調整：未編集の日を下限まで短くしても予算に収まりません。編集した日を見直すか、見送りを増やしてください。");
    } else if (fitInfo.capOthers < mx || fitInfo.capProtected < mx) {
      notes.push(`自動調整：編集した日を優先し、未編集の日を 優先する人以外 ${fitInfo.capOthers}h以内 / 優先する人 ${fitInfo.capProtected}h以内 に短縮しています`);
    }
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
  renderPersons(computed);
  renderChecklist(eff);
}

function renderCalendar(eff) {
  const colors = personColorMap(plan.staff);
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
      '<span class="legend kind"><i class="sample-hold"></i>保留・見送り</span>' +
      '<span class="legend kind">✎=編集済み・クリックで個別調整</span>';

  const weeks = buildCalendar(plan.month, mode === "raw" ? rawItems : eff);
  const head = ["月", "火", "水", "木", "金", "土", "日"]
    .map((w) => `<th class="${w === "土" ? "sat" : w === "日" ? "sun" : ""}">${w}</th>`).join("");
  const rows = weeks.map((week) => `<tr>${week.map((cell) => {
    if (!cell) return '<td class="empty"></td>';
    const chips = cell.items.map((item) => {
      const color = colors.get(item.person) || "#757575";
      if (mode === "raw") {
        const warn = item.warnings ? "⚠" : "";
        const title = `${item.person}: ${item.raw_title}${item.warnings ? "／" + item.warnings : ""}`;
        return `<span class="chip raw" style="background:${color}" title="${title}">${warn}${item.raw_title}</span>`;
      }
      const kind = item.status;
      const mark = item.edited ? "✎" : item.autoCut ? "↓" : "";
      const hours = item.proposed_hours > 0 ? ` ${item.proposed_hours}h` : "";
      const text = kind === "extra" ? `${mark}希 ${item.person}${hours}` : `${mark}${item.person}${hours}`;
      const style = kind === "fixed" ? `background:${color}`
        : kind === "extra" ? `color:${color};border-color:${color}` : "";
      const time = item.start && item.proposed_end ? `${item.start}〜${item.proposed_end}／` : "";
      return `<span class="chip ${kind} clickable" style="${style}" data-key="${item.key}" ` +
        `title="${item.raw_title}（${time}${item.action}${item.reason ? "：" + item.reason : ""}）クリックで調整">${text}</span>`;
    }).join("");
    return `<td><span class="day-no">${cell.day}</span>${chips}</td>`;
  }).join("")}</tr>`).join("");
  element("calendar").innerHTML = `<table class="shift-cal"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

function renderPersons(computed) {
  const rows = plan.staff.map((member) => {
    const row = computed.perPerson[member.name] || { days: 0, hours: 0, cost: 0 };
    return { name: member.name, protected: !!member.protected, target: member.target_days ?? null, ...row };
  });
  const totalDays = rows.reduce((sum, row) => sum + row.days, 0);
  const totalCost = rows.reduce((sum, row) => sum + row.cost, 0);
  element("person-table").innerHTML =
    "<tr><th>名前</th><th>予定日数</th><th>目安日数</th><th>人時</th><th>人件費</th></tr>" +
    rows.map((row) =>
      `<tr><td>${row.name}${row.protected ? "（優先）" : ""}</td><td>${row.days}日</td>` +
      `<td>${row.target ?? "-"}日</td><td>${row.hours}h</td><td>${formatYen(row.cost)}</td></tr>`).join("") +
    `<tr class="total"><td>合計</td><td>${totalDays}日</td><td></td><td></td><td>${formatYen(totalCost)}</td></tr>`;
}

function renderChecklist(eff) {
  const groups = buildChecklist({ items: eff });
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

// ───── 個別編集ダイアログ ─────
function updateEditHours() {
  const status = element("edit-status").value;
  if (status === "hold") {
    element("edit-hours").textContent = "見送り（0h・人件費に含めない）";
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
  saveStore("edit", overrides);
  element("edit-dialog").close();
  renderAll();
}

function clearEdit() {
  const overrides = getOverrides();
  delete overrides[editKey];
  saveStore("edit", overrides);
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
  const base = getBase();
  element("base-start").value = toInputTime(base.start);
  element("base-end").value = toInputTime(base.end);
  element("auto-fit").checked = loadStore("autofit", false);
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
  element("calendar").addEventListener("click", (event) => {
    const chip = event.target.closest(".chip[data-key]");
    if (chip) openEditor(chip.dataset.key);
  });
  for (const id of ["base-start", "base-end"]) {
    element(id).addEventListener("change", () => {
      saveStore("base", { start: element("base-start").value, end: element("base-end").value });
      renderAll();
    });
  }
  element("auto-fit").addEventListener("change", (event) => {
    saveStore("autofit", event.target.checked);
    renderAll();
  });
  element("reset-edits").addEventListener("click", () => {
    if (!confirm("この月の個別編集と基本時間帯の変更をすべてリセットしますか？")) return;
    localStorage.removeItem(storeName("edit"));
    localStorage.removeItem(storeName("base"));
    const defaults = plan.targets.allday_default;
    element("base-start").value = toInputTime(defaults.start);
    element("base-end").value = toInputTime(defaults.end);
    renderAll();
  });
  element("edit-status").addEventListener("change", updateEditHours);
  element("edit-start").addEventListener("input", updateEditHours);
  element("edit-end").addEventListener("input", updateEditHours);
  element("edit-save").addEventListener("click", saveEdit);
  element("edit-clear").addEventListener("click", clearEdit);
  element("edit-cancel").addEventListener("click", () => element("edit-dialog").close());

  if (!hasSession()) {
    element("login-area").hidden = false;
    return;
  }
  await start();
});
