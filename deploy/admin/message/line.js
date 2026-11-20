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
let templateJobs = [];
let historyCursor;
let historyLoaded = false;
let historySequence = 0;
let historyLoading = false;
let focusedTemplateJob;
const el = id => document.getElementById(id);
const labels = { ready: "未送信", accepted: "LINE受付済み",
  failed: "失敗", unknown: "結果不明・同じ送信として再確認が必要" };
const omissionLabels = { unlinked: "未登録", pending: "承認待ち", blocked: "送信停止", accepted: "同じ文面をLINE受付済み" };
const omissions = job => job?.omitted ?? [];
const describeOmission = ({ name, reason }) => `${name}（${omissionLabels[reason]}）`;

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

function registrationNotice(text, error = false) {
  el("line-registration-status").textContent = text;
  el("line-registration-status").classList.toggle("msg-error", error);
}

export function validLineState(value) {
  return value && Array.isArray(value.members) && Array.isArray(value.jobs)
    && value.members.every(member => member && typeof member.worker === "string"
      && typeof member.name === "string" && typeof member.linked === "boolean")
    && value.jobs.every(validJob);
}

const validJob = job => job && typeof job.id === "string" && typeof job.message === "string"
  && Array.isArray(job.names) && job.names.every(name => typeof name === "string")
  && job.results && job.names.every(name => Object.hasOwn(labels, job.results[name]?.status))
  && (job.omitted === undefined || Array.isArray(job.omitted)
    && job.omitted.every(item => item && typeof item.name === "string" && Object.hasOwn(omissionLabels, item.reason)));

function renderState() {
  renderIssueOptions(state.members.filter(member => !member.linked));
  const members = [...state.members].sort((a, b) => Number(Boolean(b.pending)) - Number(Boolean(a.pending)));
  el("line-members").innerHTML = members.map(member => `<article class="line-member">
    <strong>${escape(member.name)}</strong>
    <p>${member.linked ? `${member.blocked ? "ブロック検知・送信停止" : "登録済み"}：${escape(member.display_name)}`
      : member.pending ? `承認待ち：LINE表示名「${escape(member.pending.display_name)}」`
        : "未登録"}</p>
    ${member.pending ? `<button type="button" class="primary-btn" data-line-approve="${escape(member.worker)}">本人を確認して承認</button>` : ""}
    ${member.linked || member.pending ? `<button type="button" class="secondary-btn" data-line-unlink="${escape(member.worker)}">解除・取消</button>` : ""}
  </article>`).join("") || "<p>登録対象の作業者がいません。</p>";
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

function clearRegistrationCode() {
  el("line-code-text").value = "";
  el("line-code").hidden = true;
}

function clearRegistrationView() {
  el("line-members").innerHTML = "";
  clearRegistrationCode();
  renderIssueOptions([]);
}

function renderJobs() {
  const jobs = [...state.jobs].reverse();
  jobs.sort((a, b) => Number(isPending(b)) - Number(isPending(a)));
  el("line-jobs").innerHTML = jobHistory(jobs.filter(job => job.kind !== "template"));
}

const isTemplate = job => job.kind === "template";
const ackSummary = job => job.ack_enabled
  ? `本人確認 ${job.names.filter(name => job.results[name].confirmed_at).length}/${job.names.length}名`
  : "確認ボタンなし";
const ackTime = at => new Date(at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });

function recipientStatus(job, name) {
  const { status, confirmed_at: confirmedAt } = job.results[name];
  if (job.ack_enabled && confirmedAt) {
    const confirmed = `本人確認済み（${ackTime(confirmedAt)}）`;
    return status === "accepted" ? confirmed : `${labels[status]}・${confirmed}`;
  }
  if (status === "accepted") return `${labels.accepted}・${job.ack_enabled ? "確認待ち" : "確認ボタンなし"}`;
  return labels[status];
}

function historySummary(job) {
  const statuses = job.names.map(name => job.results[name].status);
  const accepted = statuses.filter(status => status === "accepted").length;
  const failed = statuses.filter(status => status === "failed").length;
  const unknown = statuses.filter(status => status === "unknown").length;
  const attempts = job.names.map(name => job.results[name].first_attempt).filter(Number.isFinite);
  const at = Number.isFinite(job.history_at) ? job.history_at : attempts.length ? Math.min(...attempts) : null;
  const time = ackTime(at === null ? job.created_at : at * 1000);
  const excluded = omissions(job);
  const total = job.names.length + excluded.length;
  const notSent = excluded.filter(item => item.reason !== "accepted");
  const earlier = excluded.length - notSent.length;
  const title = isTemplate(job) ? job.title : [...job.names, ...excluded.map(item => item.name)].join("・");
  return `<span>${escape(time)}｜${escape(title)}</span>
    <span class="line-job-meta msg-muted">宛先 ${total}名 · LINE受付 ${accepted}/${total}名 · ${ackSummary(job)}
      ${notSent.length ? ` · 送信対象外：${escape(notSent.map(describeOmission).join("・"))}` : ""}
      ${earlier ? ` · 別の履歴でLINE受付済み ${earlier}名` : ""}
      ${failed ? ` · <strong class="msg-error">送信失敗 ${failed}名</strong>` : ""}
      ${unknown ? ` · <strong class="msg-error">結果不明 ${unknown}名</strong>` : ""}
      ${job.closed ? " · 終了" : isPending(job) ? ` · ${accepted === job.names.length ? "控え未保存" : "未完了"}` : ""}</span>`;
}

function jobHistory(jobs) {
  return jobs.map(job => `<details id="line-job-${escape(job.id)}" class="line-job"${!isTemplate(job) && isPending(job) ? " open" : ""}>
    <summary>${historySummary(job)}</summary>
    <p>送信記録の日付：${escape(job.date)}</p>
    <ul>${job.names.map(name => `<li>${escape(name)}：${escape(recipientStatus(job, name))}
      ${job.results[name].error ? `<p class="msg-error">${escape(job.results[name].error)}</p>` : ""}</li>`).join("")}
      ${omissions(job).map(item => `<li>${escape(item.name)}：${item.reason === "accepted" ? "別の履歴でLINE受付済み（今回は送信対象外）" : `送信対象外（${omissionLabels[item.reason]}）`}</li>`).join("")}</ul>
    <figure class="line-job-body">
      <figcaption>本文</figcaption>
      <pre class="line-preview">
${escape(job.message)}</pre>
    </figure>
    ${job.names.some(name => job.results[name].status === "unknown")
      ? `<p class="msg-error">新規送信せず、この履歴から再試行してください（初回試行から23時間以内）。</p>` : ""}
    ${!job.recorded && !job.closed ? `<button type="button" class="primary-btn" data-line-resume="${escape(job.id)}">内容を確認して送信・再試行</button>
      <button type="button" class="secondary-btn" data-line-close="${escape(job.id)}">未送信分の送信を終了</button>` : ""}
  </details>`).join("") || "<p>この日のLINE送信履歴はありません。</p>";
}

export async function loadTemplateHistory(mode = "initial") {
  const append = mode === "more";
  if ((mode === "initial" && historyLoaded) || (mode !== "refresh" && historyLoading)
    || (append && !historyCursor)) return;
  const current = ++historySequence;
  const status = el("template-history-status");
  const more = el("template-history-more");
  historyLoading = true;
  more.disabled = true;
  status.classList.toggle("msg-error", false);
  status.textContent = "定型文の送信履歴を取得中…";
  try {
    const result = await lineApi("template_history", append ? { before: historyCursor } : {});
    if (current !== historySequence) return;
    if (!Array.isArray(result?.jobs) || !result.jobs.every(job => validJob(job) && isTemplate(job)
      && typeof job.date === "string" && Number.isFinite(job.history_at))
      || !(result.next_cursor === null || typeof result.next_cursor?.id === "string"
           && Number.isFinite(result.next_cursor.at))) throw new Error("LINE APIの応答形式が不正です。");
    const list = el("template-line-jobs");
    const added = append ? result.jobs.filter(job => !templateJobs.some(previous => previous.id === job.id)) : result.jobs;
    templateJobs = append ? [...templateJobs, ...added] : added;
    if (append) {
      if (added.length) list.insertAdjacentHTML("beforeend", jobHistory(added));
    } else {
      list.innerHTML = added.length ? jobHistory(added) : "";
    }
    if (templateJobs.some(job => job.id === focusedTemplateJob?.id)) pinTemplateJob();
    historyCursor = result.next_cursor;
    historyLoaded = true;
    status.textContent = templateJobs.length ? `${templateJobs.length}件表示中` : "定型文の送信履歴はありません。";
  } catch (error) {
    if (current !== historySequence) return;
    console.error("[line] template history fetch failed", error);
    status.classList.toggle("msg-error", true);
    status.textContent = `定型文の送信履歴を取得できませんでした。${error.message}「送信履歴・本人確認を更新」で再試行できます。`;
  } finally {
    if (current === historySequence) {
      historyLoading = false;
      more.disabled = false;
      more.hidden = !historyCursor;
    }
  }
}

function pinTemplateJob(job) {
  focusedTemplateJob = job;
  el("template-focused-job").innerHTML = job
    ? `<p class="msg-muted">今回確認する送信</p>${jobHistory([job])}` : "";
}

async function refreshAfterTemplateAction(job) {
  const wasVisible = templateJobs.some(entry => entry.id === job.id) || focusedTemplateJob?.id === job.id;
  await loadTemplateHistory("refresh");
  if (wasVisible && !templateJobs.some(entry => entry.id === job.id)) pinTemplateJob(job);
}

const isPending = job => !job.closed && !job.recorded;
const jobOverlapsGroup = (job, group) => job.names.some(name => group.recipients.includes(name));
const planTargets = group => group.entries.map(({ id, plan }) => ({ id, plan_revision: plan.updated_at }));
const matchesTargets = (job, targets) => job.targets?.length === targets.length
  && targets.every(target => job.targets.some(saved => saved.id === target.id && saved.plan_revision === target.plan_revision));
const eligible = name => state.members.some(member => member.name === name && member.linked && !member.blocked);

function cardJobs(group, jobs) {
  const newestFirst = jobs.filter(job => !isTemplate(job)).reverse();
  const targets = planTargets(group);
  const newest = newestFirst.find(job => job.recorded && matchesTargets(job, targets)
    && job.names.length + omissions(job).length === group.recipients.length
    && group.recipients.every(name => job.names.includes(name) || omissions(job).some(item => item.name === name)));
  const partial = omissions(newest).length ? newest : null;
  return {
    pending: newestFirst.find(job => isPending(job) && jobOverlapsGroup(job, group)),
    partial,
    sent: newestFirst.find(job => job.recorded
      && job.names.length === group.recipients.length
      && group.recipients.every(name => job.names.includes(name))
      && job.targets?.length === group.entries.length
      && group.entries.every(({ id }) => job.targets.some(target => target.id === id))),
  };
}

function planAudience(group, partial) {
  const remaining = omissions(partial).filter(item => item.reason !== "accepted").map(item => item.name);
  const names = (remaining.length ? remaining : group.recipients).filter(eligible);
  return { names, followUp: remaining.length > 0,
    omitted: group.recipients.filter(name => !names.includes(name)) };
}

function focusJob(job) {
  let details = el(`line-job-${job.id}`);
  if (isTemplate(job) && !details) {
    pinTemplateJob(job);
    details = el(`line-job-${job.id}`);
  }
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
    const { pending, sent, partial } = cardJobs(group, available ? state.jobs : []);
    const audience = available ? planAudience(group, partial) : null;
    const remaining = omissions(partial).filter(item => item.reason !== "accepted");
    const partialComplete = partial && !remaining.length;
    const changed = sent
      ? group.entries.some(({ id, plan }) => sent.targets.find(target => target.id === id).plan_revision !== plan.updated_at)
      : card.dataset.changed === "yes";
    const accepted = Boolean(partialComplete || sent || card.dataset.communication === "sent");
    const unknown = pending?.names.some(name => pending.results[name].status === "unknown");
    const badge = card.querySelector("[data-line-badge]");
    if (badge) {
      badge.textContent = pending ? (unknown ? "LINE送信の結果不明" : "未完了のLINE送信あり") : changed ? "連絡後に予定変更あり"
        : remaining.length ? `一部LINE受付済み（${group.recipients.length - remaining.length}/${group.recipients.length}名）`
        : accepted ? `LINE受付済み${!partialComplete && sent?.ack_enabled ? ` ／ ${ackSummary(sent)}` : ""}`
          : card.dataset.communication === "copied" ? "コピー済み（LINE未確認）" : "未連絡";
      badge.dataset.tone = pending || changed || remaining.length ? "warning" : accepted ? "accepted" : "";
    }
    const compact = accepted && !changed && !pending && !remaining.length;
    card.querySelector("[data-current-message]").dataset.compact = String(Boolean(sent && compact));
    const other = card.querySelector("[data-other-actions]");
    if (other.dataset.compact !== String(compact)) {
      other.dataset.compact = String(compact);
      other.open = !compact || Boolean(other.querySelector("[data-editor][open]"));
    }
    const resend = card.querySelector("[data-line-resend]");
    resend.replaceChildren();
    const missing = available ? group.recipients.filter(name => !eligible(name)) : [];
    const copyOnly = !pending && missing.length > 0 && !audience.names.length;
    const copyTools = card.querySelector("[data-copy-tools]");
    const copySlot = card.querySelector(copyOnly ? "[data-copy-primary]" : "[data-copy-secondary]");
    if (copyTools.parentElement !== copySlot) {
      copySlot.append(copyTools);
      const copyButton = copyTools.querySelector("[data-copy]");
      copyButton.classList.toggle("primary-btn", copyOnly);
      copyButton.classList.toggle("secondary-btn", !copyOnly);
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = compact ? "secondary-btn" : "primary-btn";
    button.textContent = pending ? "履歴から確認・再試行"
      : audience?.followUp && audience.names.length ? `未送信の${audience.names.length}名に送る`
      : !audience?.followUp && audience?.names.length && missing.length ? `承認済みの${audience.names.length}名に送る`
      : changed ? "変更後の文面を確認"
      : accepted ? "再連絡する" : "LINE送信内容を確認";
    button.disabled = busy || (!pending && (!audience?.names.length || card.dataset.planIssues === "yes"));
    button.onclick = pending ? () => focusJob(pending) : () => guarded(() => prepare(group, audience?.names));
    if (!copyOnly) (compact ? resend : controls).append(button);
    if ((partial || sent) && !pending) {
      const results = document.createElement("button");
      results.type = "button";
      results.className = "secondary-btn";
      results.textContent = "送信内容・結果を見る";
      results.disabled = busy;
      results.onclick = () => focusJob(partial || sent);
      controls.append(results);
    }
    if (!pending && missing.length) {
      const hint = document.createElement("p");
      hint.className = "msg-muted";
      hint.textContent = copyOnly
        ? `この画面からはLINE送信できません（未登録・承認待ち・送信停止：${missing.join("・")}）。`
        : `LINE対象外：${missing.join("・")}。文面をコピーして個別に連絡できます。`;
      (compact && !copyOnly ? resend : controls).append(hint);
    }
    card.querySelector("[data-line-actions]").append(controls);
  }
}

async function refresh() {
  const current = ++sequence;
  const date = context.date();
  el("line-connection").classList.toggle("line-fetch-failed", false);
  el("template-line-connection").classList.toggle("line-fetch-failed", false);
  state = undefined;
  loadedDate = "";
  el("line-updated").textContent = "";
  el("line-jobs").innerHTML = "";
  el("template-line-date").textContent = date ? `新規送信の記録日：${date}（「作業予定の連絡」の日付）` : "";
  for (const form of el("template-list").querySelectorAll("[data-template-send]")) {
    form.querySelector('button[type="submit"]').disabled = true;
  }
  if (!el("line-management").open || !date) clearRegistrationView();
  registrationNotice("登録状態を取得中…");
  decorateLineCards();
  if (!date) {
    notice("日付を選択するとLINEの状態を取得します。");
    registrationNotice("「作業予定の連絡」で日付を選択してください。");
    return;
  }
  notice("LINE登録・送信履歴を取得中…");
  let result;
  try {
    result = await lineApi(null, null, date);
    if (!validLineState(result)) throw new Error("LINE APIの応答形式が不正です。");
  } catch (error) {
    if (current !== sequence || date !== context.date()) return;
    clearRegistrationView();
    el("line-connection").classList.toggle("line-fetch-failed", true);
    el("template-line-connection").classList.toggle("line-fetch-failed", true);
    throw error;
  }
  if (current !== sequence || date !== context.date()) return;
  state = result;
  loadedDate = date;
  clearRegistrationCode();
  renderState();
  renderTemplateRecipients();
  el("line-updated").textContent = `${date}分 ／ ${new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })} 取得`;
  notice("LINE登録・送信履歴を取得しました。");
  registrationNotice("登録状態を取得しました。");
}

export async function refreshLineState() {
  try {
    await refresh();
  } catch (error) {
    console.error("[line] automatic refresh failed", error);
    notice(`${error.message}「LINEの状態を再取得」で再試行してください。コピーは使えます。`, true);
    registrationNotice(`${error.message}「登録状態を更新」で再試行してください。`, true);
  }
}

function showConfirmation(job) {
  confirmedJob = job;
  el("line-confirm-text").textContent = job.message;
  el("line-confirm-recipients").textContent = `${job.date} ／ 宛先：${job.names.join("・")}`;
  const excluded = omissions(job);
  const note = el("line-confirm-omitted");
  note.hidden = !excluded.length;
  note.textContent = excluded.length ? `今回送信しない：${excluded.map(describeOmission).join("・")}。未登録・承認待ちの方などには、必要に応じて文面をコピーして個別に連絡してください。` : "";
  el("line-confirm-ack").hidden = !job.ack_enabled;
  el("line-confirm-results").textContent = job.names.map(name =>
    `${name}：${recipientStatus(job, name)}`).join("\n");
  el("line-confirm-error").textContent = "";
  el("line-confirm").showModal();
}

async function prepare(group, displayedNames) {
  const date = context.date();
  if (!state || loadedDate !== date) throw new Error("LINE連携を再取得してください。");
  await context.check(group);
  if (date !== context.date()) throw new Error("日付が変わりました。LINE連携を再取得してください。");
  if (!state || loadedDate !== date) throw new Error("LINEの状態が変わりました。再取得して確認してください。");
  const pending = state.jobs.find(job => !isTemplate(job) && isPending(job) && jobOverlapsGroup(job, group));
  if (pending) throw new Error("この宛先には未完了の送信があります。同じ送信履歴から確認・再試行してください。");
  const { partial } = cardJobs(group, state.jobs);
  const { names, followUp, omitted } = planAudience(group, partial);
  if (!names.length || (displayedNames && JSON.stringify(displayedNames) !== JSON.stringify(names))) {
    throw new Error("LINEの宛先が変わりました。送信できる人を確認してやり直してください。");
  }
  const message = followUp ? partial.message : context.message(group);
  if (!message.trim() || message.length > 5000) throw new Error("LINE文面は空欄不可・5000文字以内です。");
  const previous = state.jobs.some(job => !isTemplate(job) && jobOverlapsGroup(job, { recipients: names }));
  if (previous && !window.confirm("この宛先には以前の送信履歴があります。新しい連絡を準備しますか？")) return;
  const job = await lineApi(omitted.length ? "prepare_partial" : "prepare", {
    date, names, message,
    targets: planTargets(group),
    confirm_resend: previous,
    ...(omitted.length ? { omit_names: omitted } : {}),
  });
  if (omitted.length && (!validJob(job) || JSON.stringify(job.names) !== JSON.stringify(names)
      || JSON.stringify(omissions(job).map(item => item.name)) !== JSON.stringify(omitted))) {
    throw new Error("送信対象外の記録を確認できません。LINEの状態とLambdaの更新を確認してください。");
  }
  await refresh();
  if (date !== context.date()) throw new Error(`${date}の送信準備が履歴に残っています。日付を戻して履歴から確認してください。`);
  showConfirmation(job);
}

export function renderTemplateRecipients() {
  const members = state?.members.filter(member => member.linked && !member.blocked) ?? [];
  for (const form of el("template-list").querySelectorAll("[data-template-send]")) {
    const fieldset = form.querySelector("[data-template-recipients]");
    const selected = new Set([...fieldset.querySelectorAll("input:checked")].map(input => input.value));
    fieldset.innerHTML = `<legend>LINEの宛先</legend>${members.length ? members.map(member =>
      `<label><input type="checkbox" value="${escape(member.name)}"${selected.has(member.name) ? " checked" : ""}> ${escape(member.name)}</label>`).join(" ")
      : `<p>${state ? "送信できるLINE登録済みの作業者がいません。" : "LINE登録状態の取得後に選択できます。"}</p>`}`;
    form.querySelector('button[type="submit"]').disabled = !members.length;
  }
}

async function prepareTemplate(form) {
  const date = context.date();
  if (!state || loadedDate !== date) throw new Error("LINEの状態を再取得してください。");
  const title = form.dataset.title;
  const names = [...form.querySelectorAll("[data-template-recipients] input:checked")].map(input => input.value);
  const message = form.querySelector("[data-template-text]").value;
  if (!names.length) throw new Error("送信する宛先を選んでください。");
  if (!title.trim() || !message.trim() || message.length > 5000) throw new Error("タイトルと本文（5000文字以内）を確認してください。");
  const relevant = state.jobs.filter(job => isTemplate(job) && job.message === message
    && jobOverlapsGroup(job, { recipients: names }));
  const pending = relevant.find(isPending);
  if (pending) {
    notice("この宛先には同じ本文の未完了の定型文があります。同じ送信履歴から確認・再試行してください。", true);
    return pending;
  }
  const duplicates = names.filter(name => relevant.some(job => job.results[name]?.status === "accepted"));
  if (duplicates.length && !window.confirm(`${duplicates.join("・")}には ${date} 分として同じ本文の定型文がLINE受付済みです。別の連絡として送信準備を進めますか？`)) return;
  const job = await lineApi("prepare_template", { date, names, title, message, confirm_resend: Boolean(duplicates.length) });
  await refresh();
  if (date !== context.date()) throw new Error(`${date}分の定型文の送信準備が履歴に残っています。`);
  void loadTemplateHistory("refresh");
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
        `${person}：${recipientStatus(updated, person)}`).join("\n");
    }
    el("line-confirm").close();
    confirmedJob = null;
    if (!isTemplate(job)) await context.reload();
    await refresh();
    if (isTemplate(job)) await refreshAfterTemplateAction(updated);
    notice(updated.recorded ? (omissions(updated).length ? `今回の送信対象 ${updated.names.length}名のLINE受付と控え保存が完了しました。`
      : "全員のLINE受付と控え保存が完了しました。")
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
  el("line-management-controls").inert = true;
  el("line-management-open").disabled = true;
  el("line-history").inert = true;
  el("template-line-jobs").inert = true;
  el("template-focused-job").inert = true;
  el("template-line-refresh").disabled = true;
  el("line-refresh").disabled = true;
  decorateLineCards();
  try { return await task(); }
  catch (error) { console.error("[line] operation failed", error); report(error.message, true); }
  finally {
    busy = false;
    el("line-management-controls").inert = false;
    el("line-management-open").disabled = false;
    el("line-history").inert = false;
    el("template-line-jobs").inert = false;
    el("template-focused-job").inert = false;
    el("template-line-refresh").disabled = false;
    el("line-refresh").disabled = false;
    decorateLineCards();
  }
}

export function initLineMessaging(options) {
  context = options;
  const management = el("line-management");
  const refreshManagement = () => guarded(refreshLineState);
  el("line-management-open").onclick = () => {
    management.showModal();
    return refreshManagement();
  };
  el("line-management-refresh").onclick = refreshManagement;
  el("line-management-close").onclick = () => { if (!busy) management.close(); };
  management.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
  management.addEventListener("close", () => {
    clearRegistrationCode();
    el("line-management-open").focus();
  });
  el("line-refresh").onclick = () => guarded(refreshLineState);
  el("template-line-refresh").onclick = () => guarded(() => Promise.all([
    refreshLineState(), loadTemplateHistory("refresh"),
  ]));
  el("template-history-more").onclick = () => loadTemplateHistory("more");
  el("template-list").onsubmit = async event => {
    event.preventDefault();
    const form = event.target;
    const status = form.querySelector("[data-template-status]");
    status.textContent = "";
    status.classList.remove("msg-error");
    const pending = await guarded(() => prepareTemplate(form), text => {
      status.textContent = text;
      status.classList.add("msg-error");
    });
    if (pending) focusJob(pending);
  };
  el("line-issue-worker").onchange = () => {
    el("line-issue").disabled = !el("line-issue-worker").value;
    clearRegistrationCode();
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
    const id = resume?.dataset.lineResume ?? close?.dataset.lineClose;
    const job = id && (state?.jobs.find(job => job.id === id) || templateJobs.find(job => job.id === id)
      || (focusedTemplateJob?.id === id ? focusedTemplateJob : null));
    if (!job) return;
    if (resume) showConfirmation(job);
    if (close && window.confirm("この送信の未送信分を終了します。受付済み分の取り消しはできません。よろしいですか？")) {
      return guarded(async () => {
        const updated = await lineApi("close", { date: job.date, job_id: job.id, confirm: true });
        await refresh();
        if (isTemplate(job)) await refreshAfterTemplateAction(updated);
      });
    }
  };
  el("line-jobs").onclick = handleHistory;
  el("template-line-jobs").onclick = handleHistory;
  el("template-focused-job").onclick = handleHistory;
  el("line-confirm-send").onclick = () => guarded(deliver);
  el("line-confirm-cancel").onclick = () => { el("line-confirm").close(); confirmedJob = null; };
  el("line-confirm").addEventListener("cancel", event => { if (busy) event.preventDefault(); });
}
