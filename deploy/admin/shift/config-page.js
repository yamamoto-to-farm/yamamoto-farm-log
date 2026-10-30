import { verifyLocalAuth } from "/common/ui.js";
import { renderHeader } from "/common/header.js?v=1.1";
import { config } from "/photos/config.js";
import { clearSession, ensureToken, hasSession, login } from "/photos/auth.js?v=20261029-2";

const element = (id) => document.getElementById(id);
const WEEKDAYS = ["月", "火", "水", "木", "金", "土", "日"];
let cfg = null;

function status(message, isError = false) {
  element("status").textContent = message;
  element("status").classList.toggle("error", isError);
}

async function api(path, { body } = {}) {
  const token = await ensureToken();
  if (!token) throw new Error("ログインの期限が切れました。再ログインしてください。");
  const options = { cache: "no-store", headers: { Authorization: `Bearer ${token}` } };
  if (body) {
    options.method = "POST";
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`${config.api}${path}`, options);
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

// ───── 全体設定 ─────
const GLOBALS = [
  ["g-base-hourly", (c) => c.base_hourly, (c, v) => (c.base_hourly = v)],
  ["g-hours-target", (c) => c.hours_per_day_target, (c, v) => (c.hours_per_day_target = v)],
  ["g-tpd-min", (c) => c.target_person_days.min, (c, v) => (c.target_person_days.min = v)],
  ["g-tpd-center", (c) => c.target_person_days.center, (c, v) => (c.target_person_days.center = v)],
  ["g-tpd-max", (c) => c.target_person_days.max, (c, v) => (c.target_person_days.max = v)],
  ["g-budget-min", (c) => c.labor_budget_yen.min, (c, v) => (c.labor_budget_yen.min = v)],
  ["g-budget-max", (c) => c.labor_budget_yen.max, (c, v) => (c.labor_budget_yen.max = v)],
  ["g-commute-day", (c) => c.commute.per_day, (c, v) => (c.commute.per_day = v)],
  ["g-commute-cap", (c) => c.commute.monthly_cap, (c, v) => (c.commute.monthly_cap = v)],
  ["g-min-hours", (c) => c.min_work_hours, (c, v) => (c.min_work_hours = v)],
  ["g-max-hours", (c) => c.max_work_hours, (c, v) => (c.max_work_hours = v)],
  ["g-peak-hours", (c) => c.peak_max_work_hours, (c, v) => (c.peak_max_work_hours = v)],
  ["g-flex-hours", (c) => c.flex_all_day_assumed_hours, (c, v) => (c.flex_all_day_assumed_hours = v)],
  ["g-weekly-max", (c) => c.weekly_max_days, (c, v) => (c.weekly_max_days = v)],
  ["g-consec-max", (c) => c.consecutive_max_days, (c, v) => (c.consecutive_max_days = v)],
  ["g-break-no", (c) => c.break_minutes.not_spanning_noon, (c, v) => (c.break_minutes.not_spanning_noon = v)],
  ["g-break-noon", (c) => c.break_minutes.spanning_noon, (c, v) => (c.break_minutes.spanning_noon = v)],
];
const TIME_GLOBALS = [
  ["g-am-start", "am_default", "start"], ["g-am-end", "am_default", "end"],
  ["g-pm-start", "pm_default", "start"], ["g-pm-end", "pm_default", "end"],
  ["g-all-start", "allday_default", "start"], ["g-all-end", "allday_default", "end"],
];

function pad(time) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time || "");
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : "";
}

function renderGlobals() {
  for (const [id, get] of GLOBALS) element(id).value = get(cfg);
  for (const [id, key, part] of TIME_GLOBALS) element(id).value = pad(cfg[key]?.[part]);
  element("g-calendar-code").value = cfg.timetree_calendar_code || "";
}

function collectGlobals(out) {
  for (const [id, , set] of GLOBALS) {
    const value = Number(element(id).value);
    if (!Number.isFinite(value)) throw new Error(`「${element(id).closest("label").textContent.trim()}」を入力してください。`);
    set(out, value);
  }
  for (const [id, key, part] of TIME_GLOBALS) {
    const value = element(id).value;
    if (!value) throw new Error("AM/PM/終日の時間帯をすべて入力してください。");
    out[key][part] = value;
  }
  out.timetree_calendar_code = element("g-calendar-code").value.trim();
}

// ───── スタッフ ─────
function staffCard(member) {
  const card = document.createElement("div");
  card.className = "staff-card";
  const weekdayBoxes = WEEKDAYS.map((w) =>
    `<label class="wd"><input type="checkbox" data-field="wd" value="${w}"${(member.fixed_weekdays || []).includes(w) ? " checked" : ""}>${w}</label>`).join("");
  const latest = Object.entries(member.latest_end || {}).map(([w, t]) => `${w}:${t}`).join(", ");
  card.innerHTML = `
    <div class="cfg-grid">
      <label>名前<input data-field="name" type="text" value="${member.name || ""}"></label>
      <label>時給（円）<input data-field="hourly" type="number" min="1" value="${member.hourly ?? ""}"></label>
      <label>目安日数<input data-field="target" type="number" min="0" value="${member.target_days ?? ""}"></label>
      <label class="cfg-check"><input data-field="protected" type="checkbox"${member.protected ? " checked" : ""}>優先（希望どおりを優先）</label>
    </div>
    <div class="cfg-row"><span class="cfg-label">決まった曜日</span>${weekdayBoxes}</div>
    <div class="cfg-grid">
      <label>一致キーワード（カンマ区切り）<input data-field="match" type="text" value="${(member.match || []).join(", ")}"></label>
      <label>終了の上限（例: 日:15:00, 月:15:00）<input data-field="latest" type="text" value="${latest}"></label>
      <label>入れない日（毎月・カンマ区切り）<input data-field="unavailable" type="text" value="${(member.unavailable_days_of_month || []).join(", ")}"></label>
    </div>
    <button type="button" class="danger-btn cfg-remove">このスタッフを削除</button>`;
  card.querySelector(".cfg-remove").addEventListener("click", () => {
    if (confirm(`「${card.querySelector('[data-field="name"]').value}」を削除しますか？`)) card.remove();
  });
  return card;
}

function renderStaff() {
  const list = element("staff-list");
  list.innerHTML = "";
  for (const member of cfg.staff) list.appendChild(staffCard(member));
}

function collectStaff() {
  const staff = [];
  for (const card of element("staff-list").querySelectorAll(".staff-card")) {
    const field = (name) => card.querySelector(`[data-field="${name}"]`);
    const name = field("name").value.trim();
    if (!name) throw new Error("名前が空のスタッフがあります。");
    const latest = {};
    const latestText = field("latest").value.trim();
    if (latestText) {
      for (const part of latestText.split(/[、,]/)) {
        const m = /^\s*([月火水木金土日])\s*[:：=]\s*(\d{1,2}:\d{2})\s*$/.exec(part);
        if (!m) throw new Error(`${name}さんの「終了の上限」は「日:15:00, 月:15:00」の形式で入力してください。`);
        latest[m[1]] = m[2];
      }
    }
    const unavailable = field("unavailable").value.split(/[、,]/).map((s) => s.trim()).filter(Boolean)
      .map((s) => {
        const n = Number(s);
        if (!Number.isInteger(n) || n < 1 || n > 31) throw new Error(`${name}さんの「入れない日」は1〜31の数値にしてください。`);
        return n;
      });
    const match = field("match").value.split(/[、,]/).map((s) => s.trim()).filter(Boolean);
    const targetRaw = field("target").value;
    staff.push({
      name,
      match: match.length ? match : [name],
      fixed_weekdays: [...card.querySelectorAll('[data-field="wd"]:checked')].map((box) => box.value),
      target_days: targetRaw === "" ? null : Number(targetRaw),
      protected: field("protected").checked,
      hourly: Number(field("hourly").value),
      latest_end: latest,
      unavailable_days_of_month: unavailable,
    });
  }
  return staff;
}

// ───── 読み込み・保存 ─────
async function load() {
  status("読み込み中…");
  cfg = await api("/shift/config");
  renderGlobals();
  renderStaff();
  element("config-area").hidden = false;
  status("");
}

async function save() {
  element("save-result").textContent = "";
  try {
    const out = JSON.parse(JSON.stringify(cfg));
    collectGlobals(out);
    out.staff = collectStaff();
    if (!confirm("設定を保存しますか？（保存前の設定は自動でバックアップされます）")) return;
    const result = await api("/shift/config", { body: out });
    cfg = out;
    element("save-result").textContent = `✅ 保存しました（スタッフ${result.staff}人）。`;
    await offerRegenerate();
  } catch (error) {
    element("save-result").textContent = `⚠ ${error.message}`;
  }
}

// 保存後、最新月のシフト案の再計算を提案する
async function offerRegenerate() {
  let month = "";
  try {
    const result = await api("/shift/months");
    month = result.months[0] || "";
  } catch (error) {
    console.warn("months load failed", error);
  }
  if (!month) return;
  if (!confirm(`${month} のシフト案を、新しい設定でいま再計算しますか？（約1分）`)) {
    element("save-result").textContent += " 次回の自動生成（毎月26日）から反映されます。";
    return;
  }
  const result = await api("/shift/regenerate", { body: { month } });
  element("save-result").textContent += ` 🔄 ${month} の再計算を開始しました。${result.note || ""}`;
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
  element("login").addEventListener("click", () => login("/admin/shift/config.html"));
  element("save").addEventListener("click", save);
  element("reload").addEventListener("click", () => load().catch((error) => status(error.message, true)));
  element("add-staff").addEventListener("click", () => {
    element("staff-list").appendChild(staffCard({ hourly: cfg?.base_hourly ?? 1250, fixed_weekdays: [] }));
  });

  if (!hasSession()) {
    element("login-area").hidden = false;
    return;
  }
  try {
    await load();
  } catch (error) {
    if (!hasSession()) {
      element("login-area").hidden = false;
      status("");
      return;
    }
    status(error.message, true);
  }
});
