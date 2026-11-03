import { fetchPlannedWork } from "/diary/planned-work.js?v=20261103-2";
import { hasSession, login } from "/photos/auth.js?v=20261029-2";
import { formatLocalYmd } from "/common/date-utils.js?v=1";

const escape = value => String(value ?? "").replace(/[&<>"']/g,
  char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

export function topPlansHtml(people) {
  if (!Object.keys(people).length) return "<p>この日の予定は保存されていません。</p>";
  return Object.entries(people).map(([worker, plan]) =>
    `<article class="top-plan-person"><h3>${escape(worker)}</h3>${
      plan.off ? `<p>中止の連絡${plan.off_reason ? `：${escape(plan.off_reason)}` : ""}</p>`
        : plan.blocks.map(block => `<p>${escape(block.start)}〜${escape(block.end)}<br>${escape(block.task)}${block.field ? `｜${escape(block.field)}` : ""}</p>`).join("")
    }</article>`).join("");
}

export function initTopWorkPlans(baseDate = new Date()) {
  const card = document.getElementById("ops-schedule-card");
  const allowed = ["admin", "family"].includes(window.currentRole);
  card.className = "ops-card ops-card--info";
  card.innerHTML = `${allowed ? `
    <div class="top-plan-header"><span class="ops-card__label">作業予定</span>
      <div class="top-plan-switch" aria-label="作業予定の日付">
        <button type="button" data-plan-day="0" aria-pressed="true">今日</button>
        <button type="button" data-plan-day="1" aria-pressed="false">明日</button>
      </div>
    </div>
    <p id="top-plan-date"></p>
    <div id="top-plan-body" aria-live="polite"></div>
    <a id="top-plan-create" class="primary-btn" href="/admin/message/index.html">作業予定を作る・連絡する</a>
    <p class="top-plan-note">業務連絡から保存された予定を表示しています。</p>
  ` : ""}
    <details class="ops-card__section" id="top-plan-hints">
      <summary>予定を組むための確認事項</summary>
      <div id="top-plan-hints-body">読み込み中…</div>
    </details>`;
  if (!allowed) return;
  const body = document.getElementById("top-plan-body");
  const link = document.getElementById("top-plan-create");
  const buttons = card.querySelectorAll("[data-plan-day]");
  let sequence = 0;
  const action = (label, handler) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary-btn";
    button.textContent = label;
    button.onclick = handler;
    body.append(button);
  };
  const load = async offset => {
    const current = ++sequence;
    const date = new Date(baseDate);
    date.setDate(date.getDate() + offset);
    const requestedDate = formatLocalYmd(date);
    document.getElementById("top-plan-date").textContent = `${date.getMonth() + 1}/${date.getDate()}（${"日月火水木金土"[date.getDay()]}）`;
    link.href = `/admin/message/index.html?date=${requestedDate}`;
    buttons.forEach(button => button.setAttribute("aria-pressed", String(Number(button.dataset.planDay) === offset)));
    body.replaceChildren();
    if (!hasSession()) {
      body.textContent = "予定の表示にはログインが必要です。";
      action("ログイン", () => login(`/index.html?planDate=${requestedDate}`));
      return;
    }
    body.textContent = "予定を読み込み中…";
    try {
      const people = await fetchPlannedWork(requestedDate);
      if (current !== sequence) return;
      body.innerHTML = topPlansHtml(people);
    } catch (error) {
      if (current !== sequence) return;
      console.error("[top] planned work load failed", requestedDate, error);
      body.textContent = error.message;
      if (!hasSession()) action("ログイン", () => login(`/index.html?planDate=${requestedDate}`));
      action("再試行", () => load(offset));
    }
  };
  buttons.forEach(button => button.addEventListener("click", () => load(Number(button.dataset.planDay))));
  const tomorrow = new Date(baseDate);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const requested = new URLSearchParams(location.search).get("planDate");
  return load(requested === formatLocalYmd(tomorrow) ? 1 : 0);
}
