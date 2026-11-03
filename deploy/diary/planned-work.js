import { config } from "/photos/config.js";
import { ensureToken, hasSession, login } from "/photos/auth.js?v=20261029-2";

const TASK_FOLDERS = {
  播種: "seed", 育苗: "nursery", 定植: "planting", 収穫: "harvest",
  耕起: "tillage", "土づくり・耕起": "tillage", 中耕: "intertill", 畝立て: "bedmaking",
  "除草・草刈り": "weeding", 除草: "weeding", 草刈り: "weeding", 除草剤散布: "weeding",
  草とり: "hand-weeding", 手作業除草: "hand-weeding", 防除: "pesticide",
  施肥: "fertilizer", 潅水: "watering", 灌水: "watering", 圃場整備: "field-maintenance",
};
const LOG_PAGES = {
  seed: ["/seed/index.html", "播種ログ"],
  planting: ["/planting/index.html", "定植ログ"],
  harvest: ["/harvest/index.html", "収穫ログ"],
  tillage: ["/field/tillage/index.html", "土づくり・耕起ログ"],
  intertill: ["/intertill/index.html", "中耕ログ"],
  bedmaking: ["/bedmaking/index.html", "畝立てログ"],
  weeding: ["/field/weeding/index.html", "除草・草刈りログ"],
  "hand-weeding": ["/hand-weeding/index.html", "除草ログ（手作業）"],
  pesticide: ["/pesticide/index.html", "防除ログ"],
  fertilizer: ["/fertilizer/index.html", "施肥ログ"],
  watering: ["/watering/index.html", "潅水ログ"],
  "field-maintenance": ["/field/maintenance/index.html", "圃場整備ログ"],
};
const text = value => String(value ?? "").normalize("NFKC").trim();
const split = value => (Array.isArray(value) ? value : [value])
  .flatMap(item => text(item).split(/[\/／、,\n]/)).map(text).filter(Boolean);
const escape = value => String(value ?? "").replace(/[&<>"']/g,
  char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
let sequence = 0;

export function relatedPlanLogs(worker, block, logs) {
  const task = text(block.task);
  const folder = Object.hasOwn(TASK_FOLDERS, task) ? TASK_FOLDERS[task] : undefined;
  return logs.filter(log => {
    const data = log.data || {};
    const workers = Object.entries(data).filter(([key]) => /^worker(?:s|\d+)?$/.test(key))
      .flatMap(([, value]) => split(value));
    if (!workers.includes(text(worker))) return false;
    const fields = Array.isArray(block.fields) ? block.fields.map(text).filter(Boolean) : split(block.field);
    if (fields.length && !split(data.field).some(field => fields.includes(field))) return false;
    if (["草刈り", "除草剤散布"].includes(task) && text(data.workType) !== task) return false;
    return folder ? log.folder === folder
      : [log.displayName, data.workType].some(value => text(value) === task);
  });
}

export function plannedWorkHtml(people, logs) {
  const entries = Object.entries(people);
  if (!entries.length) return "<p>この日の予定は保存されていません。</p>";
  return entries.map(([worker, saved]) => {
    const plans = saved.entries || [saved];
    return `<article class="planned-work-person"><h3>${escape(worker)}</h3>${plans.map(plan => {
    const source = plan.source_label || (plan.source && plan.source !== "message" ? plan.source : "業務連絡");
    const blocks = plan.off ? "<p>中止の連絡" + (plan.off_reason ? `：${escape(plan.off_reason)}` : "") + "</p>"
      : plan.blocks.map(block => {
        const matches = logs === null ? null : relatedPlanLogs(worker, block, logs);
        const task = text(block.task);
        const page = Object.hasOwn(TASK_FOLDERS, task) ? LOG_PAGES[TASK_FOLDERS[task]] : undefined;
        const result = matches === null ? "作業ログを取得できないため、比較できません。"
          : matches.length ? `関連する作業ログ：${matches.map(log => escape(log.displayName)).join("・")}（${matches.length}件）`
            : "該当する作業ログは見つかりません。"
              + (page ? ` <a href="${escape(page[0])}">${escape(page[1])}へ</a>` : "");
        const fields = Array.isArray(block.fields) ? block.fields.join("・") : block.field;
        const time = block.start && block.end ? `${escape(block.start)}〜${escape(block.end)}　` : "";
        return `<div class="planned-work-block"><p>${time}${escape(block.task)}${fields ? `｜${escape(fields)}` : ""}${block.shed ? "（作業場集合）" : ""}</p><p class="planned-work-related">${result}</p></div>`;
      }).join("");
    return `<div><small>登録元：${escape(source)}</small>${blocks}${plan.memo ? `<p>${escape(plan.memo)}</p>` : ""}${plan.manual_text ? "<p class=\"planned-work-related\">連絡文面に手修正あり。予定は入力欄の内容です。</p>" : ""}</div>`;
    }).join("")}</article>`;
  }).join("");
}

export async function fetchWorkPlanRecord(date) {
  const token = await ensureToken();
  if (!token) throw new Error("予定を見るにはログインが必要です。");
  const response = await fetch(`${config.api}/shift/work-plans?${new URLSearchParams({ date })}`, {
    cache: "no-store", headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`予定を取得できません（${response.status}）。`);
  const result = await response.json();
  const validPlan = plan => plan && typeof plan.off === "boolean" && Array.isArray(plan.blocks)
    && plan.blocks.every(block => block && typeof block.task === "string"
      && (block.fields === undefined || (Array.isArray(block.fields) && block.fields.every(field => typeof field === "string")))
      && (block.companions === undefined || (Array.isArray(block.companions) && block.companions.every(name => typeof name === "string"))));
  const validNamedPlan = plan => validPlan(plan) && Array.isArray(plan.names)
    && plan.names.every(name => typeof name === "string")
    && (plan.recipients === undefined || (Array.isArray(plan.recipients) && plan.recipients.every(name => typeof name === "string")));
  const validCommunication = item => item && ["copied", "sent"].includes(item.status)
    && typeof item.at === "string" && typeof item.plan_revision === "string";
  if (result?.date !== date || result.data?.date !== date || !result.data.people
      || typeof result.data.people !== "object" || Array.isArray(result.data.people)
      || Object.values(result.data.people).some(plan => !validPlan(plan)
        || (plan.entries !== undefined && (!Array.isArray(plan.entries) || !plan.entries.every(validPlan))))
      || (result.data.plans !== undefined && (!result.data.plans || Array.isArray(result.data.plans)
        || typeof result.data.plans !== "object" || Object.values(result.data.plans).some(plan =>
          !validNamedPlan(plan) || (plan.last_communication != null && !validCommunication(plan.last_communication)))))
      || (result.data.communications !== undefined && (!Array.isArray(result.data.communications)
        || result.data.communications.some(item => !validCommunication(item)
          || typeof item.id !== "string" || typeof item.plan_id !== "string" || typeof item.message !== "string"
          || !Array.isArray(item.recipients) || !item.recipients.every(name => typeof name === "string")
          || !validNamedPlan(item.plan))))) {
    throw new Error("予定データの形式が不正です。");
  }
  return result;
}

export async function fetchPlannedWork(date) {
  return (await fetchWorkPlanRecord(date)).data.people;
}

export async function writeWorkPlan(request) {
  const token = await ensureToken();
  if (!token) throw new Error("予定の保存にはログインが必要です。");
  const response = await fetch(`${config.api}/shift/work-plans`, {
    method: "POST", cache: "no-store",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    if (response.status === 409) throw new Error("別の端末で予定が更新されました。再読み込みして内容を確認してください。");
    throw new Error(`予定を保存できません（${response.status}）。`);
  }
  const result = await response.json();
  if (result.saved !== true || result.date !== request.date) throw new Error("予定の保存完了を確認できませんでした。");
  return result;
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
