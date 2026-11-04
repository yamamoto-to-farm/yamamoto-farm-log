import { config } from "/photos/config.js";
import { ensureToken } from "/photos/auth.js?v=20261029-2";

const escape = value => String(value ?? "").replace(/[&<>"']/g,
  char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
let context;
let state;
let loadedDate = "";
let sequence = 0;
let busy = false;
let confirmedJob;
const el = id => document.getElementById(id);
const labels = { ready: "未送信", accepted: "LINE受付済み（配達・既読は未確認）",
  failed: "失敗", unknown: "結果不明・同じ送信として再確認が必要" };

export async function lineApi(action, body, date) {
  const token = await ensureToken();
  if (!token) throw new Error("LINE連携にはログインが必要です。");
  const response = await fetch(`${config.api}/line/manage${action ? "" : `?${new URLSearchParams({ date })}`}`, {
    method: action ? "POST" : "GET", cache: "no-store",
    headers: { Authorization: `Bearer ${token}`, ...(action ? { "Content-Type": "application/json" } : {}) },
    ...(action ? { body: JSON.stringify({ ...body, action }) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || `LINE APIエラー（${response.status}）。`);
  return result;
}

function notice(text, error = false) {
  el("line-status").textContent = text;
  el("line-status").classList.toggle("msg-error", error);
}

export function validLineState(value) {
  return value && Array.isArray(value.members) && Array.isArray(value.jobs)
    && value.members.every(member => member && typeof member.worker === "string"
      && typeof member.name === "string" && typeof member.linked === "boolean")
    && value.jobs.every(job => job && typeof job.id === "string" && typeof job.message === "string"
      && Array.isArray(job.names) && job.names.every(name => typeof name === "string")
      && job.results && job.names.every(name => Object.hasOwn(labels, job.results[name]?.status)));
}

function renderState() {
  el("line-members").innerHTML = state.members.map(member => `<article class="line-member">
    <strong>${escape(member.name)}</strong>
    <p>${member.linked ? `${member.blocked ? "ブロック検知・送信停止" : "登録済み"}：${escape(member.display_name)}`
      : member.pending ? `承認待ち：LINE表示名「${escape(member.pending.display_name)}」`
        : "未登録"}</p>
    ${!member.linked ? `<button type="button" class="secondary-btn" data-line-issue="${escape(member.worker)}">登録コードを発行${member.pending ? "し直す" : ""}</button>` : ""}
    ${member.pending ? `<button type="button" class="primary-btn" data-line-approve="${escape(member.worker)}">本人を確認して承認</button>` : ""}
    ${member.linked || member.pending ? `<button type="button" class="secondary-btn" data-line-unlink="${escape(member.worker)}">解除・取消</button>` : ""}
  </article>`).join("");
  renderJobs();
  decorateLineCards();
}

function renderJobs() {
  el("line-jobs").innerHTML = [...state.jobs].reverse().map(job => `<details class="line-job"${job.recorded || job.closed ? "" : " open"}>
    <summary>${escape(job.names.join("・"))}：${job.closed ? "終了" : job.recorded ? "全員LINE受付済み・控え保存済み" : "未完了の送信"}</summary>
    <p>${escape(job.created_at)} ／ ${escape(job.date)}</p>
    <pre class="line-preview">${escape(job.message)}</pre>
    <ul>${job.names.map(name => `<li>${escape(name)}：${escape(labels[job.results[name].status])}
      ${job.results[name].error ? `<p class="msg-error">${escape(job.results[name].error)}</p>` : ""}</li>`).join("")}</ul>
    ${!job.recorded && !job.closed ? `<button type="button" class="primary-btn" data-line-resume="${escape(job.id)}">内容を確認して送信・再試行</button>
      <button type="button" class="secondary-btn" data-line-close="${escape(job.id)}">未送信分の送信を終了</button>` : ""}
  </details>`).join("") || "<p>この日のLINE送信履歴はありません。</p>";
}

export function decorateLineCards() {
  if (!context) return;
  const date = context.date();
  for (const card of el("cards").querySelectorAll("[data-group]")) {
    card.querySelector("[data-line-card]")?.remove();
    const group = context.groups().find(group => group.id === card.dataset.group);
    if (!group) continue;
    const controls = document.createElement("div");
    controls.dataset.lineCard = "";
    const available = state && loadedDate === date;
    const missing = available ? group.recipients.filter(name =>
      !state.members.some(member => member.name === name && member.linked && !member.blocked)) : [];
    const button = document.createElement("button");
    button.type = "button";
    button.className = "primary-btn";
    button.textContent = "LINE送信内容を確認";
    button.disabled = busy || !available || missing.length > 0;
    button.onclick = () => guarded(() => prepare(group));
    const hint = document.createElement("p");
    hint.className = "msg-muted";
    hint.textContent = !available ? "LINE登録状態は「LINE連携を取得」で確認してください。コピーは従来どおり使えます。"
      : missing.length ? `LINE未登録・送信停止：${missing.join("・")}。登録・承認するか、コピーで連絡してください。`
        : "個人宛てに同じ文面を送信します。送信前に確認画面を開きます。";
    controls.append(button, hint);
    card.append(controls);
  }
}

async function refresh() {
  const current = ++sequence;
  const date = context.date();
  state = undefined;
  decorateLineCards();
  notice("LINE登録・送信履歴を取得中…");
  const result = await lineApi(null, null, date);
  if (current !== sequence || date !== context.date()) return;
  if (!validLineState(result)) throw new Error("LINE APIの応答形式が不正です。");
  state = result;
  loadedDate = date;
  el("line-code").hidden = true;
  renderState();
  notice("LINE登録・送信履歴を取得しました。");
}

function showConfirmation(job) {
  confirmedJob = job;
  el("line-confirm-text").textContent = job.message;
  el("line-confirm-recipients").textContent = `${job.date} ／ 宛先：${job.names.join("・")}`;
  el("line-confirm-results").textContent = job.names.map(name =>
    `${name}：${labels[job.results[name].status]}`).join("\n");
  el("line-confirm-error").textContent = "";
  el("line-confirm").showModal();
}

async function prepare(group) {
  const date = context.date();
  if (!state || loadedDate !== date) throw new Error("LINE連携を再取得してください。");
  await context.check(group);
  if (date !== context.date() || loadedDate !== date) throw new Error("日付が変わりました。LINE連携を再取得してください。");
  const message = context.message(group);
  if (!message.trim() || message.length > 5000) throw new Error("LINE文面は空欄不可・5000文字以内です。");
  const previous = state.jobs.some(job => job.names.some(name => group.recipients.includes(name)));
  if (previous && !window.confirm("この日には以前の送信準備・履歴があります。未完了分は同じ送信として再開します。完了済みの場合は新しい連絡として再送します。続けますか？")) return;
  const job = await lineApi("prepare", {
    date, names: group.recipients, message,
    targets: group.entries.map(({ id, plan }) => ({ id, plan_revision: plan.updated_at })),
    confirm_resend: previous,
  });
  await refresh();
  showConfirmation(job);
}

async function deliver() {
  const job = confirmedJob;
  if (!job) return;
  el("line-confirm-send").disabled = true;
  el("line-confirm-cancel").disabled = true;
  context.lock(true);
  try {
    let updated = job;
    for (const name of job.names) {
      if (updated.results[name].status === "accepted" && updated.recorded) continue;
      updated = await lineApi("send", { date: job.date, job_id: job.id, name });
      el("line-confirm-results").textContent = updated.names.map(person =>
        `${person}：${labels[updated.results[person].status]}`).join("\n");
    }
    el("line-confirm").close();
    confirmedJob = null;
    await context.reload();
    await refresh();
    notice(updated.recorded ? "全員のLINE受付と控え保存が完了しました。配達・既読は未確認です。"
      : "未完了の宛先があります。下の送信履歴で人ごとの結果を確認してください。", !updated.recorded);
  } catch (error) {
    console.error("[line] delivery failed", error);
    el("line-confirm-error").textContent = `${error.message} 結果不明の可能性があるため、新しい送信を作らず、閉じて「LINE連携を取得」から履歴を確認してください。`;
    notice("送信を完了できませんでした。確認画面の説明に従い、履歴を再取得してください。", true);
  } finally {
    context.lock(false);
    el("line-confirm-send").disabled = false;
    el("line-confirm-cancel").disabled = false;
  }
}

async function memberAction(button) {
  const action = button.dataset.lineIssue ? "issue" : button.dataset.lineApprove ? "approve" : "unlink";
  const worker = button.dataset.lineIssue || button.dataset.lineApprove || button.dataset.lineUnlink;
  const member = state?.members.find(member => member.worker === worker);
  if (!member) throw new Error("登録状態を再取得してください。");
  if (action !== "issue" && !window.confirm(action === "approve"
    ? `${member.name}さんのLINE表示名が「${member.pending.display_name}」であることを、本人に確認しましたか？`
    : `${member.name}さんのLINE登録・承認待ちを解除します。未送信の連絡は停止されます。よろしいですか？`)) return;
  const result = await lineApi(action, { worker, pending_id: member.pending?.id, confirm: true });
  await refresh();
  if (action === "issue") {
    el("line-code-text").value = result.registration_message;
    el("line-code").hidden = false;
    el("line-code-text").focus();
    el("line-code-text").select();
    notice("登録コードは15分有効です。対象の本人にだけ渡し、LINE表示名と本人を確認してから承認してください。");
  }
}

async function guarded(task) {
  if (busy) return;
  busy = true;
  el("line-management").inert = true;
  decorateLineCards();
  try { await task(); }
  catch (error) { console.error("[line] operation failed", error); notice(error.message, true); }
  finally {
    busy = false;
    el("line-management").inert = false;
    decorateLineCards();
  }
}

export function initLineMessaging(options) {
  context = options;
  el("line-refresh").onclick = () => guarded(refresh);
  el("line-members").onclick = event => {
    const button = event.target.closest("[data-line-issue], [data-line-approve], [data-line-unlink]");
    if (button) guarded(() => memberAction(button));
  };
  el("line-jobs").onclick = event => {
    const resume = event.target.closest("[data-line-resume]");
    const close = event.target.closest("[data-line-close]");
    if (resume) {
      const job = state.jobs.find(job => job.id === resume.dataset.lineResume);
      if (job) showConfirmation(job);
    }
    if (close && window.confirm("この送信の未送信分を終了します。受付済み分の取り消しはできません。よろしいですか？")) {
      guarded(async () => {
        await lineApi("close", { date: loadedDate, job_id: close.dataset.lineClose, confirm: true });
        await refresh();
      });
    }
  };
  el("line-confirm-send").onclick = () => guarded(deliver);
  el("line-confirm-cancel").onclick = () => { el("line-confirm").close(); confirmedJob = null; };
  el("line-confirm").addEventListener("cancel", event => { if (busy) event.preventDefault(); });
}
