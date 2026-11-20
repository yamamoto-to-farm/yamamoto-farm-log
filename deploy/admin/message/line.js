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
let templateTitle = "";
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
  el("template-line-status").textContent = text;
  el("template-line-status").classList.toggle("msg-error", error);
}

function templateNotice(text, error = false) {
  el("template-send-status").textContent = text;
  el("template-send-status").classList.toggle("msg-error", error);
}

function registrationNotice(text, error = false) {
  el("line-registration-status").textContent = text;
  el("line-registration-status").classList.toggle("msg-error", error);
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
  renderIssueOptions(state.members.filter(member => !member.linked));
  el("line-members").innerHTML = state.members.map(member => `<article class="line-member">
    <strong>${escape(member.name)}</strong>
    <p>${member.linked ? `${member.blocked ? "ブロック検知・送信停止" : "登録済み"}：${escape(member.display_name)}`
      : member.pending ? `承認待ち：LINE表示名「${escape(member.pending.display_name)}」`
        : "未登録"}</p>
    ${member.pending ? `<button type="button" class="primary-btn" data-line-approve="${escape(member.worker)}">本人を確認して承認</button>` : ""}
    ${member.linked || member.pending ? `<button type="button" class="secondary-btn" data-line-unlink="${escape(member.worker)}">解除・取消</button>` : ""}
  </article>`).join("");
  renderJobs();
  decorateLineCards();
}

function renderIssueOptions(members) {
  const select = el("line-issue-worker");
  select.innerHTML = `<option value="">${members.length || !state ? "対象者を選択" : "発行対象者はいません"}</option>`
    + members.map(member => `<option value="${escape(member.worker)}">${escape(member.name)}${member.pending ? "（承認待ち）" : ""}</option>`).join("");
  select.value = "";
  select.disabled = !members.length;
  el("line-issue").disabled = true;
}

function renderJobs() {
  const jobs = [...state.jobs].reverse();
  jobs.sort((a, b) => Number(isPending(b)) - Number(isPending(a)));
  el("line-jobs").innerHTML = jobHistory(jobs.filter(job => job.kind !== "template"));
  el("template-line-jobs").innerHTML = jobHistory(jobs.filter(job => job.kind === "template"));
}

const isTemplate = job => job.kind === "template";
const ackSummary = job => job.ack_enabled
  ? `本人確認 ${job.names.filter(name => job.results[name].confirmed_at).length}/${job.names.length}名`
  : "確認ボタンなし";
const ackTime = at => new Date(at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });

function jobHistory(jobs) {
  return jobs.map(job => `<details id="line-job-${escape(job.id)}" class="line-job"${isPending(job) ? " open" : ""}>
    <summary>${isTemplate(job) ? `${escape(job.title)} ／ ` : ""}${escape(job.names.join("・"))}：${job.closed ? "終了" : job.recorded ? "全員LINE受付済み・控え保存済み" : "未完了の送信"} ／ ${ackSummary(job)}</summary>
    <p>${escape(job.created_at)} ／ ${escape(job.date)}</p>
    <ul>${job.names.map(name => `<li>${escape(name)}：${escape(labels[job.results[name].status])}
      ${job.ack_enabled ? ` ／ ${job.results[name].confirmed_at ? `本人確認済み（${escape(ackTime(job.results[name].confirmed_at))}）`
        : job.results[name].status === "accepted" ? "確認待ち" : "本人確認なし"}` : ""}
      ${job.results[name].error ? `<p class="msg-error">${escape(job.results[name].error)}</p>` : ""}</li>`).join("")}</ul>
    <pre class="line-preview">${escape(job.message)}</pre>
    ${!job.recorded && !job.closed ? `<button type="button" class="primary-btn" data-line-resume="${escape(job.id)}">内容を確認して送信・再試行</button>
      <button type="button" class="secondary-btn" data-line-close="${escape(job.id)}">未送信分の送信を終了</button>` : ""}
  </details>`).join("") || "<p>この日のLINE送信履歴はありません。</p>";
}

const isPending = job => !job.closed && !job.recorded;
const jobOverlapsGroup = (job, group) => job.names.some(name => group.recipients.includes(name));

function cardJobs(group, jobs) {
  const newestFirst = jobs.filter(job => !isTemplate(job)).reverse();
  return {
    pending: newestFirst.find(job => isPending(job) && jobOverlapsGroup(job, group)),
    sent: newestFirst.find(job => job.recorded
      && job.names.length === group.recipients.length
      && group.recipients.every(name => job.names.includes(name))
      && job.targets?.length === group.entries.length
      && group.entries.every(({ id }) => job.targets.some(target => target.id === id))),
  };
}

function focusJob(job) {
  const details = el(`line-job-${job.id}`);
  details.open = true;
  const summary = details.querySelector("summary");
  summary.focus({ preventScroll: true });
  summary.scrollIntoView({ block: "center" });
}

export function decorateLineCards() {
  if (!context) return;
  const date = context.date();
  const available = state && loadedDate === date;
  const groups = new Map(context.groups().map(group => [group.id, group]));
  for (const card of el("cards").querySelectorAll("[data-group]")) {
    card.querySelector("[data-line-card]")?.remove();
    const group = groups.get(card.dataset.group);
    if (!group) continue;
    const controls = document.createElement("div");
    controls.dataset.lineCard = "";
    controls.className = "msg-line-actions";
    const { pending, sent } = cardJobs(group, available ? state.jobs : []);
    const changed = sent
      ? group.entries.some(({ id, plan }) => sent.targets.find(target => target.id === id).plan_revision !== plan.updated_at)
      : card.dataset.changed === "yes";
    const accepted = Boolean(sent || card.dataset.communication === "sent");
    const unknown = pending?.names.some(name => pending.results[name].status === "unknown");
    const badge = card.querySelector("[data-line-badge]");
    if (badge) {
      badge.textContent = pending ? (unknown ? "LINE送信の結果不明" : "未完了のLINE送信あり") : changed ? "連絡後に予定変更あり"
        : accepted ? `LINE受付済み${sent?.ack_enabled ? ` ／ ${ackSummary(sent)}` : ""}`
          : card.dataset.communication === "copied" ? "コピー済み（LINE未確認）" : "未連絡";
      badge.dataset.tone = pending || changed ? "warning" : accepted ? "accepted" : "";
    }
    const compact = accepted && !changed && !pending;
    card.querySelector("[data-current-message]").dataset.compact = String(Boolean(sent && compact));
    const other = card.querySelector("[data-other-actions]");
    if (other.dataset.compact !== String(compact)) {
      other.dataset.compact = String(compact);
      other.open = !compact || Boolean(other.querySelector("[data-editor][open]"));
    }
    const resend = card.querySelector("[data-line-resend]");
    resend.replaceChildren();
    const missing = available ? group.recipients.filter(name =>
      !state.members.some(member => member.name === name && member.linked && !member.blocked)) : [];
    const button = document.createElement("button");
    button.type = "button";
    button.className = compact ? "secondary-btn" : "primary-btn";
    button.textContent = pending ? "履歴から確認・再試行" : changed ? "変更後の文面を確認"
      : accepted ? "再連絡する" : "LINE送信内容を確認";
    button.disabled = busy || (!pending && (!available || missing.length > 0 || card.dataset.planIssues === "yes"));
    button.onclick = pending ? () => focusJob(pending) : () => guarded(() => prepare(group));
    if (compact) resend.append(button);
    else controls.append(button);
    if (sent && !pending) {
      const results = document.createElement("button");
      results.type = "button";
      results.className = "secondary-btn";
      results.textContent = "送信内容・結果を見る";
      results.disabled = busy;
      results.onclick = () => focusJob(sent);
      controls.append(results);
    }
    if (!pending && missing.length) {
      const hint = document.createElement("p");
      hint.className = "msg-muted";
      hint.textContent = `LINE未登録・送信停止：${missing.join("・")}。登録・承認するか、コピーで連絡してください。`;
      (compact ? resend : controls).append(hint);
    }
    card.querySelector("[data-line-actions]").append(controls);
  }
}

async function refresh() {
  const current = ++sequence;
  const date = context.date();
  el("line-connection").classList.toggle("line-fetch-failed", false);
  state = undefined;
  loadedDate = "";
  el("line-updated").textContent = "";
  el("line-members").innerHTML = "";
  el("line-jobs").innerHTML = "";
  el("template-line-jobs").innerHTML = "";
  el("template-line-date").textContent = date ? `${date}分（「作業予定の連絡」で日付を変更できます）` : "";
  el("template-prepare").disabled = true;
  templateNotice("");
  el("line-code-text").value = "";
  el("line-code").hidden = true;
  registrationNotice("");
  renderIssueOptions([]);
  decorateLineCards();
  if (!date) {
    notice("日付を選択するとLINEの状態を取得します。");
    return;
  }
  notice("LINE登録・送信履歴を取得中…");
  let result;
  try {
    result = await lineApi(null, null, date);
    if (!validLineState(result)) throw new Error("LINE APIの応答形式が不正です。");
  } catch (error) {
    if (current !== sequence || date !== context.date()) return;
    el("line-connection").classList.toggle("line-fetch-failed", true);
    throw error;
  }
  if (current !== sequence || date !== context.date()) return;
  state = result;
  loadedDate = date;
  renderState();
  renderTemplateRecipients();
  el("line-updated").textContent = `${date}分 ／ ${new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })} 取得`;
  notice("LINE登録・送信履歴を取得しました。");
}

export async function refreshLineState() {
  try {
    await refresh();
  } catch (error) {
    console.error("[line] automatic refresh failed", error);
    notice(`${error.message}「LINEの状態を再取得」で再試行してください。コピーは使えます。`, true);
  }
}

function showConfirmation(job) {
  confirmedJob = job;
  el("line-confirm-text").textContent = job.message;
  el("line-confirm-recipients").textContent = `${job.date} ／ 宛先：${job.names.join("・")}`;
  el("line-confirm-ack").hidden = !job.ack_enabled;
  el("line-confirm-results").textContent = job.names.map(name =>
    `${name}：${labels[job.results[name].status]}`).join("\n");
  el("line-confirm-error").textContent = "";
  el("line-confirm").showModal();
}

async function prepare(group) {
  const date = context.date();
  if (!state || loadedDate !== date) throw new Error("LINE連携を再取得してください。");
  await context.check(group);
  if (date !== context.date()) throw new Error("日付が変わりました。LINE連携を再取得してください。");
  if (!state || loadedDate !== date) throw new Error("LINEの状態が変わりました。再取得して確認してください。");
  const pending = state.jobs.find(job => !isTemplate(job) && isPending(job) && jobOverlapsGroup(job, group));
  if (pending) throw new Error("この宛先には未完了の送信があります。同じ送信履歴から確認・再試行してください。");
  const message = context.message(group);
  if (!message.trim() || message.length > 5000) throw new Error("LINE文面は空欄不可・5000文字以内です。");
  const previous = state.jobs.some(job => !isTemplate(job) && jobOverlapsGroup(job, group));
  if (previous && !window.confirm("この宛先には以前の送信履歴があります。新しい連絡を準備しますか？")) return;
  const job = await lineApi("prepare", {
    date, names: group.recipients, message,
    targets: group.entries.map(({ id, plan }) => ({ id, plan_revision: plan.updated_at })),
    confirm_resend: previous,
  });
  await refresh();
  if (date !== context.date()) throw new Error(`${date}の送信準備が履歴に残っています。日付を戻して履歴から確認してください。`);
  showConfirmation(job);
}

function renderTemplateRecipients(clear = false) {
  const fieldset = el("template-recipients");
  const selected = new Set(clear ? [] : [...fieldset.querySelectorAll("input:checked")].map(input => input.value));
  const members = state?.members.filter(member => member.linked && !member.blocked) ?? [];
  fieldset.innerHTML = `<legend>LINEの宛先</legend>${members.length ? members.map(member =>
    `<label><input type="checkbox" value="${escape(member.name)}"${selected.has(member.name) ? " checked" : ""}> ${escape(member.name)}</label>`).join(" ")
    : "<p>送信できるLINE登録済みの作業者がいません。</p>"}`;
  el("template-prepare").disabled = !members.length;
}

export function openTemplateSend(title, text) {
  if (busy) return;
  templateTitle = title;
  el("template-send-title").textContent = title;
  el("template-send-text").value = text;
  el("template-send").hidden = false;
  templateNotice("");
  renderTemplateRecipients(true);
  el("template-send-text").focus();
}

async function prepareTemplate() {
  const date = context.date();
  if (!state || loadedDate !== date) throw new Error("LINEの状態を再取得してください。");
  const title = templateTitle;
  const names = [...el("template-recipients").querySelectorAll("input:checked")].map(input => input.value);
  const message = el("template-send-text").value;
  if (!names.length) throw new Error("送信する宛先を選んでください。");
  if (!title.trim() || !message.trim() || message.length > 5000) throw new Error("タイトルと本文（5000文字以内）を確認してください。");
  const relevant = state.jobs.filter(job => isTemplate(job) && jobOverlapsGroup(job, { recipients: names }));
  const pending = relevant.find(isPending);
  if (pending) {
    notice("この宛先には未完了の定型文があります。同じ送信履歴から確認・再試行してください。", true);
    return pending;
  }
  if (relevant.length && !window.confirm("この宛先には選択日の定型文送信履歴があります。新しい連絡を準備しますか？")) return;
  const job = await lineApi("prepare_template", { date, names, title, message, confirm_resend: Boolean(relevant.length) });
  await refresh();
  if (date !== context.date()) throw new Error(`${date}分の定型文の送信準備が履歴に残っています。`);
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
    if (!isTemplate(job)) await context.reload();
    await refresh();
    if (isTemplate(job) && updated.recorded) el("template-send").hidden = true;
    notice(updated.recorded ? "全員のLINE受付と控え保存が完了しました。配達・既読は未確認です。"
      : "未完了の宛先があります。下の送信履歴で人ごとの結果を確認してください。", !updated.recorded);
  } catch (error) {
    console.error("[line] delivery failed", error);
    el("line-confirm-error").textContent = `${error.message} 結果不明の可能性があるため、新しい送信を作らず、閉じて「LINEの状態を再取得」から履歴を確認してください。`;
    notice("送信を完了できませんでした。確認画面の説明に従い、履歴を再取得してください。", true);
  } finally {
    context.lock(false);
    el("line-confirm-send").disabled = false;
    el("line-confirm-cancel").disabled = false;
  }
}

async function memberAction(action, worker) {
  const member = state?.members.find(member => member.worker === worker);
  if (!member) throw new Error("登録状態を再取得してください。");
  if (action === "issue") {
    if (member.linked) throw new Error("登録済みの作業者には発行できません。");
    if ((member.pending || member.expires_at * 1000 > Date.now())
      && !window.confirm(`${member.name}さんの登録コードを発行し直しますか？以前のコード・承認待ちは無効になります。`)) return;
  } else if (!window.confirm(action === "approve"
    ? `${member.name}さんのLINE表示名が「${member.pending.display_name}」であることを、本人に確認しましたか？`
    : `${member.name}さんのLINE登録・承認待ちを解除します。未送信の連絡は停止されます。よろしいですか？`)) return;
  const result = await lineApi(action, { worker, pending_id: member.pending?.id, confirm: true });
  await refresh();
  if (action === "issue") {
    el("line-code-label").textContent = `${member.name}さん専用の登録メッセージ（15分有効・全文を個人LINEから送信）`;
    el("line-code-text").value = result.registration_message;
    el("line-code").hidden = false;
    return true;
  }
}

async function guarded(task, report = notice) {
  if (busy) return;
  busy = true;
  el("line-management").inert = true;
  el("line-history").inert = true;
  el("template-line-jobs").inert = true;
  el("template-line-refresh").disabled = true;
  el("line-refresh").disabled = true;
  decorateLineCards();
  try { return await task(); }
  catch (error) { console.error("[line] operation failed", error); report(error.message, true); }
  finally {
    busy = false;
    el("line-management").inert = false;
    el("line-history").inert = false;
    el("template-line-jobs").inert = false;
    el("template-line-refresh").disabled = false;
    el("line-refresh").disabled = false;
    decorateLineCards();
  }
}

export function initLineMessaging(options) {
  context = options;
  el("line-refresh").onclick = () => guarded(refreshLineState);
  el("template-line-refresh").onclick = () => guarded(refreshLineState);
  el("template-send").onsubmit = async event => {
    event.preventDefault();
    const pending = await guarded(prepareTemplate, templateNotice);
    if (pending) focusJob(pending);
  };
  el("line-issue-worker").onchange = () => {
    el("line-issue").disabled = !el("line-issue-worker").value;
    el("line-code-text").value = "";
    el("line-code").hidden = true;
    registrationNotice("");
  };
  el("line-issue").onclick = async () => {
    const worker = el("line-issue-worker").value;
    if (await guarded(() => memberAction("issue", worker), registrationNotice)) {
      el("line-code-text").focus();
      el("line-code-text").select();
    }
  };
  el("line-members").onclick = event => {
    const button = event.target.closest("[data-line-approve], [data-line-unlink]");
    if (button) return guarded(() => button.dataset.lineApprove
      ? memberAction("approve", button.dataset.lineApprove) : memberAction("unlink", button.dataset.lineUnlink), registrationNotice);
  };
  const handleHistory = event => {
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
  el("line-jobs").onclick = handleHistory;
  el("template-line-jobs").onclick = handleHistory;
  el("line-confirm-send").onclick = () => guarded(deliver);
  el("line-confirm-cancel").onclick = () => { el("line-confirm").close(); confirmedJob = null; };
  el("line-confirm").addEventListener("cancel", event => { if (busy) event.preventDefault(); });
}
