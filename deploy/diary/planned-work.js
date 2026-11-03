import { config } from "/photos/config.js";
import { ensureToken, hasSession, login } from "/photos/auth.js?v=20261029-2";

const TASK_FOLDERS = {
  播種: "seed", 育苗: "nursery", 定植: "planting", 収穫: "harvest",
  耕起: "tillage", "土づくり・耕起": "tillage", 中耕: "intertill", 畝立て: "bedmaking",
  "除草・草刈り": "weeding", 除草: "weeding", 草刈り: "weeding",
  草とり: "hand-weeding", 手作業除草: "hand-weeding", 防除: "pesticide",
  施肥: "fertilizer", 潅水: "watering", 灌水: "watering", 圃場整備: "field-maintenance",
};
const text = value => String(value ?? "").normalize("NFKC").trim();
const split = value => (Array.isArray(value) ? value : [value])
  .flatMap(item => text(item).split(/[\/／、,\n]/)).map(text).filter(Boolean);
const escape = value => String(value ?? "").replace(/[&<>"']/g,
  char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
let sequence = 0;

export function relatedPlanLogs(worker, block, logs) {
  const task = text(block.task);
  const folder = TASK_FOLDERS[task];
  return logs.filter(log => {
    const data = log.data || {};
    const workers = Object.entries(data).filter(([key]) => /^worker(?:s|\d+)?$/.test(key))
      .flatMap(([, value]) => split(value));
    if (!workers.includes(text(worker))) return false;
    if (text(block.field) && !split(data.field).includes(text(block.field))) return false;
    return folder ? log.folder === folder
      : [log.displayName, data.workType].some(value => text(value) === task);
  });
}

export function plannedWorkHtml(people, logs) {
  const entries = Object.entries(people);
  if (!entries.length) return "<p>この日の予定は保存されていません。</p>";
  return entries.map(([worker, plan]) => {
    const source = plan.source_label || (plan.source && plan.source !== "message" ? plan.source : "業務連絡");
    const blocks = plan.off ? "<p>中止の連絡" + (plan.off_reason ? `：${escape(plan.off_reason)}` : "") + "</p>"
      : plan.blocks.map(block => {
        const matches = logs === null ? null : relatedPlanLogs(worker, block, logs);
        const result = matches === null ? "作業ログを取得できないため、比較できません。"
          : matches.length ? `関連する作業ログ：${matches.map(log => escape(log.displayName)).join("・")}（${matches.length}件）`
            : "該当する作業ログは見つかりません。";
        return `<div class="planned-work-block"><p>${escape(block.start)}〜${escape(block.end)}　${escape(block.task)}${block.field ? `｜${escape(block.field)}` : ""}${block.shed ? "（作業場集合）" : ""}</p><p class="planned-work-related">${result}</p></div>`;
      }).join("");
    return `<article class="planned-work-person"><h3>${escape(worker)} <small>登録元：${escape(source)}</small></h3>${blocks}${plan.memo ? `<p>${escape(plan.memo)}</p>` : ""}${plan.manual_text ? "<p class=\"planned-work-related\">連絡文面に手修正あり。予定は入力欄の内容です。</p>" : ""}</article>`;
  }).join("");
}

export async function fetchPlannedWork(date) {
  const token = await ensureToken();
  if (!token) throw new Error("予定を見るにはログインが必要です。");
  const response = await fetch(`${config.api}/shift/work-plans?${new URLSearchParams({ date })}`, {
    cache: "no-store", headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`予定を取得できません（${response.status}）。`);
  const result = await response.json();
  if (result?.date !== date || result.data?.date !== date || !result.data.people
      || typeof result.data.people !== "object" || Array.isArray(result.data.people)
      || Object.values(result.data.people).some(plan => !plan || typeof plan.off !== "boolean"
        || !Array.isArray(plan.blocks) || plan.blocks.some(block => !block || typeof block.task !== "string"))) {
    throw new Error("予定データの形式が不正です。");
  }
  return result.data.people;
}

export async function renderPlannedWork(date, logsPromise) {
  const current = ++sequence;
  const panel = document.getElementById("plannedWorkPanel");
  if (!panel) return;
  const body = document.getElementById("plannedWorkBody");
  panel.hidden = !["admin", "family"].includes(window.currentRole);
  body.replaceChildren();
  if (panel.hidden) return;
  panel.open = true;
  const button = (label, action) => {
    const element = document.createElement("button");
    element.type = "button";
    element.className = "secondary-btn";
    element.textContent = label;
    element.onclick = action;
    body.append(element);
  };
  if (!hasSession()) {
    body.textContent = "予定の表示にはシフト連携ログインが必要です。";
    button("ログイン", () => login(`/diary/index.html${location.search}`));
    return;
  }
  body.textContent = "予定を読み込み中…";
  try {
    const [people, logs] = await Promise.all([fetchPlannedWork(date), logsPromise]);
    if (current !== sequence) return;
    body.innerHTML = plannedWorkHtml(people, logs);
  } catch (error) {
    if (current !== sequence) return;
    console.error("[diary] planned work load failed", date, error);
    body.textContent = error.message;
    if (!hasSession()) button("ログイン", () => login(`/diary/index.html${location.search}`));
    button("再試行", () => renderPlannedWork(date, logsPromise));
  }
}
