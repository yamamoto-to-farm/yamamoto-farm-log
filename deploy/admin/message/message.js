import { verifyLocalAuth } from "/common/ui.js?v=1";
import { showSaveResult } from "/common/save-modal.js?v=20261105-result-1";
import { renderHeader } from "/common/header.js?v=1.1";
import { hasSession, login } from "/photos/auth.js?v=20261029-2";
import { formatLocalYmd, parseDateInputLocal } from "/common/date-utils.js?v=1";
import { fetchWorkPlanRecord, writeWorkPlan } from "/diary/planned-work.js?v=20261104-time-1";
import { loadPlanWorkers } from "/common/work-plan-form.js?v=20261104-modal-1";
import { communicationIssues, messageGroups, buildGroupMessage, checkMessageGroup, groupCommunicationState, recordGroupCopy } from "./message-plan.js?v=20261108-date-1";
import { initLineMessaging, decorateLineCards } from "./line.js?v=20261104-line-1";

const PRESIGN_URL = "https://7bx9hgk4d1.execute-api.ap-northeast-1.amazonaws.com/prod/presign";
const MASTERS_KEY = "data/message/masters.json";
const WEEKDAYS = "日月火水木金土";
const DEFAULT_TEMPLATES = [
  { title: "シフト入力のお願い", body: "お疲れさまです。\n{来月}月の勤務希望の入力をお願いします。\nいつものカレンダー（TimeTree）に、タイトル「希」付きで入力してください\n（例：希　終日、希　〜15:00）。\n25日ごろまでにお願いします。" },
  { title: "シフト確定のお知らせ", body: "お疲れさまです。\n{来月}月のシフトをカレンダー（TimeTree）に反映しました。\n「希」が付いていない予定が確定分です。ご確認をお願いします。\n※「希」のまま残っている日は、作業の様子を見て3日前までに連絡します。" },
  { title: "出勤簿の確認", body: "お疲れさまです。\n{月}月分の出勤簿・給与明細です。ご確認お願いします。\n問題なければ、{翌月5日}に振込ませて頂きます。\nよろしくお願いします。" },
];
const element = id => document.getElementById(id);
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g,
  char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
let masters = { templates: structuredClone(DEFAULT_TEMPLATES) };
let tplDraft = [];
let record;
let familyRecipientNames = new Set();
let sequence = 0;
let copying = false;
let loadedDate = "";
const drafts = new Map();
let commonMode = false;
const commonSelection = new Set();
function status(message, error = false) {
  element("status").textContent = message;
  element("status").classList.toggle("error", error);
  element("msg-login").hidden = hasSession();
}
function initialMessageDate() {
  const requested = new URLSearchParams(location.search).get("date");
  const parsed = parseDateInputLocal(requested);
  if (requested && parsed && formatLocalYmd(parsed) === requested) return requested;
  if (requested) console.warn("[message] invalid requested date", requested);
  return formatLocalYmd(new Date());
}
function syncWorkPlanLink() {
  const date = element("msg-date").value;
  element("direct-plan-link").href = `/schedule/daily-plan/index.html?date=${date}`;
  element("back-plan-link").href = `/schedule/daily-plan/index.html?date=${date}`;
}
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    try {
      area.select();
      if (!document.execCommand("copy")) throw new Error("文面をコピーできませんでした。再試行してください。");
    } finally {
      area.remove();
    }
  }
}
export function appendCommonMessage(text, addition) {
  const closing = [...text.matchAll(/^[ \t]*よろしくお願いします。[ \t]*\r?$/gm)].at(-1);
  const index = closing ? closing.index : text.length;
  const before = text.slice(0, index);
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const separator = !before || before.endsWith(newline + newline) ? ""
    : before.endsWith(newline) ? newline : newline + newline;
  return before + separator + addition + (closing ? newline + newline + text.slice(index) : "");
}
function syncCommonSelection() {
  const ids = new Set(record ? messageGroups(record.data.plans, familyRecipientNames).map(group => group.id) : []);
  for (const id of commonSelection) if (!ids.has(id)) commonSelection.delete(id);
  element("common-open").disabled = !ids.size;
  element("common-open").setAttribute("aria-expanded", String(commonMode));
  element("common-panel").hidden = !commonMode;
  element("common-apply").textContent = `選択した${commonSelection.size}件に追加`;
  element("cards").querySelectorAll("[data-group]").forEach(card => {
    const selected = commonSelection.has(card.dataset.group);
    card.classList.toggle("selectable", commonMode);
    card.classList.toggle("selected", commonMode && selected);
    const button = card.querySelector("[data-select]");
    button.hidden = !commonMode;
    button.setAttribute("aria-pressed", String(selected));
    button.textContent = selected ? "✓ 追加先に選択中" : "追加先に選択";
  });
}
function setCommonMode(active) {
  commonMode = active;
  commonSelection.clear();
  element("common-status").textContent = "";
  syncCommonSelection();
  if (active) element("common-text").focus();
}
function selectCommonCards(all) {
  commonSelection.clear();
  if (all && record) messageGroups(record.data.plans, familyRecipientNames).forEach(group => commonSelection.add(group.id));
  syncCommonSelection();
}
function currentMessageText(group) {
  return drafts.get(group.id)
    ?? groupCommunicationState(group, record.data.communications)?.message
    ?? buildGroupMessage(group, loadedDate);
}
function applyCommonMessage() {
  const addition = element("common-text").value.trim();
  const error = element("common-status");
  if (!commonMode || !record || copying) return;
  if (!commonSelection.size) { error.textContent = "追加先のカードを選択してください。"; return; }
  if (!addition) { error.textContent = "共通の連絡内容を入力してください。"; return; }
  const updates = messageGroups(record.data.plans, familyRecipientNames).filter(group => commonSelection.has(group.id))
    .map(group => [group.id, appendCommonMessage(currentMessageText(group), addition)]);
  if (updates.length !== commonSelection.size) {
    error.textContent = "追加先の予定が変わりました。カードを選び直してください。";
    syncCommonSelection();
    return;
  }
  if (updates.some(([, text]) => text.length > 10000)) {
    error.textContent = "追加後の文面が10000文字を超えるカードがあります。内容を短くしてください（まだ追加していません）。";
    return;
  }
  updates.forEach(([id, text]) => drafts.set(id, text));
  element("common-text").value = "";
  setCommonMode(false);
  renderCards();
  status(`${updates.length}件の文面に共通の連絡を追加しました。内容を確認してコピーしてください（予定は変更していません）。`);
  element("common-open").focus();
}
function handleCardClick(event) {
  const select = event.target.closest("[data-select]");
  const card = event.target.closest("[data-group]");
  if (commonMode && card && (select || !event.target.closest("button, a, textarea, input, select, label"))) {
    const id = card.dataset.group;
    if (commonSelection.has(id)) commonSelection.delete(id);
    else commonSelection.add(id);
    syncCommonSelection();
    return;
  }
  const copy = event.target.closest("[data-copy]");
  if (copy) return copySavedPlan(copy.dataset.copy, copy);
  const reset = event.target.closest("[data-reset]");
  if (reset && record) {
    const group = messageGroups(record.data.plans, familyRecipientNames).find(item => item.id === reset.dataset.reset);
    if (group) { drafts.set(group.id, buildGroupMessage(group, loadedDate)); renderCards(); }
  }
}
function renderCards() {
  const groups = messageGroups(record.data.plans, familyRecipientNames);
  element("cards").innerHTML = groups.length ? groups.map(group => {
    const { id, entries } = group;
    const issues = [...new Set([...group.issues, ...entries.flatMap(({ plan }) => communicationIssues(plan))])];
    const text = currentMessageText(group);
    const communication = groupCommunicationState(group, record.data.communications);
    return `<article class="msg-card" data-group="${escapeHtml(id)}">
      <button type="button" class="secondary-btn msg-select" data-select="${escapeHtml(id)}" aria-label="${escapeHtml(group.recipients.join("・"))} の連絡文を追加先に選択" aria-pressed="false" hidden>追加先に選択</button>
      <h3>${escapeHtml(group.recipients.join("・"))} へ</h3>
      <p class="msg-muted">${communication ? `${communication.status === "sent" ? "送信済み（LINE受付・配達未確認）" : "連絡用にコピー済み"}${communication.changed ? "・連絡後に変更あり" : ""}` : "この宛先・予定の組合せでは連絡前"}</p>
      ${entries.map(({ id: planId, plan, displayPlan }) => `<p>${plan.off ? "中止の連絡：" : ""}${displayPlan.blocks.map(block =>
        `${escapeHtml(block.start)}〜${escapeHtml(block.end)} ${escapeHtml(block.task)}`).join("・")}
        <a href="/schedule/daily-plan/index.html?date=${loadedDate}&id=${encodeURIComponent(planId)}">この予定を編集</a></p>`).join("")}
      ${issues.length ? `<p class="msg-error">${issues.map(escapeHtml).join("<br>")}</p>` : ""}
      <p class="msg-muted" data-help="連絡文の手修正について">文面の補足・言い換えは予定には反映されません。</p>
      ${!drafts.has(id) && communication?.message != null ? '<p class="msg-muted">最新の控えから文面を復元しました（共通の連絡・手修正を含みます）。</p>' : ""}
      ${communication?.changed ? `<p class="msg-error">予定が変わったため、現在の予定から文面を作り直しました。以前の注意事項は<a href="/schedule/daily-plan/index.html?date=${loadedDate}">連絡時点の控え</a>で確認してください。</p>` : ""}
      <textarea class="preview-edit" data-preview="${escapeHtml(id)}" rows="10" aria-label="連絡文面">${escapeHtml(text)}</textarea>
      <button type="button" class="secondary-btn" data-reset="${escapeHtml(id)}">保存済み予定から文面を戻す</button>
      <button type="button" class="primary-btn" data-copy="${escapeHtml(id)}"${issues.length ? " disabled" : ""}>📋 コピー（送信はしません）</button>
      <p data-copy-status="${escapeHtml(id)}" class="msg-muted" role="status"></p>
    </article>`;
  }).join("") : "<p>この日の連絡予定はありません。予定の追加・編集で作業者と連絡先を指定してください。</p>";
  syncCommonSelection();
  decorateLineCards();
}
async function loadSavedPlans(autoSelectDate = false) {
  if (copying) return;
  const current = ++sequence;
  const date = element("msg-date").value;
  if (!date) { status("日付を選択してください。", true); return; }
  record = null;
  drafts.clear();
  element("cards").replaceChildren();
  element("common-text").value = "";
  setCommonMode(false);
  syncWorkPlanLink();
  status("保存済み予定を読み込み中…");
  try {
    const [result, workers] = await Promise.all([fetchWorkPlanRecord(date), loadPlanWorkers()]);
    if (current !== sequence) return;
    familyRecipientNames = new Set(workers.filter(worker => worker.role === "family").map(worker => worker.display));
    if (!result.data.plans || !Array.isArray(result.data.communications)) throw new Error("予定APIの更新が必要です。");
    if (autoSelectDate === true && date === formatLocalYmd(new Date())) {
      const groups = messageGroups(result.data.plans, familyRecipientNames);
      const completed = groups.length > 0 && groups.every(group => {
        const communication = groupCommunicationState(group, result.data.communications);
        return communication && !communication.changed && ["copied", "sent"].includes(communication.status);
      });
      if (completed) {
        const tomorrow = parseDateInputLocal(date);
        tomorrow.setDate(tomorrow.getDate() + 1);
        element("msg-date").value = formatLocalYmd(tomorrow);
        return loadSavedPlans();
      }
    }
    record = result;
    loadedDate = date;
    renderCards();
    status("");
  } catch (error) {
    if (current !== sequence) return;
    console.error("[message] plans load failed", error);
    status(`${error.message}「予定を読み込む」で再試行してください。`, true);
  }
}
export async function copySavedPlan(id, button) {
  if (copying || !record) return;
  const group = messageGroups(record.data.plans, familyRecipientNames).find(item => item.id === id);
  const date = loadedDate;
  const notice = button.parentElement.querySelector("[data-copy-status]");
  let copied = false;
  let recorded = false;
  copying = true;
  element("tab-daily").inert = true;
  try {
    if (!group) throw new Error("連絡対象の予定がありません。再読み込みしてください。");
    const issues = [...group.issues, ...group.entries.flatMap(({ plan }) => communicationIssues(plan))];
    if (issues.length) throw new Error(issues.join(" "));
    const latest = await fetchWorkPlanRecord(date);
    checkMessageGroup(group, latest.data.plans);
    const text = currentMessageText(group);
    if (!text.trim()) throw new Error("連絡文面を入力してください。");
    if (text.length > 10000) throw new Error("連絡文面は10000文字以内にしてください。");
    await copyText(text);
    copied = true;
    notice.textContent = "コピー済み・控えを保存中…";
    await recordGroupCopy(date, group, text, fetchWorkPlanRecord, writeWorkPlan);
    recorded = true;
    record = await fetchWorkPlanRecord(date);
    renderCards();
    status("連絡用にコピーし、控えを保存しました（LINE送信はしていません）。");
  } catch (error) {
    console.error("[message] copy record failed", error);
    const message = recorded ? `コピーと控えの保存は完了しましたが、再取得できません。${error.message} 再読み込みしてください。`
      : copied ? `コピー済みですが、控えを保存できませんでした。${error.message} 再コピーで再試行できます。` : error.message;
    notice.textContent = message;
    status(message, true);
  } finally {
    copying = false;
    element("tab-daily").inert = false;
  }
}
async function loadMasters() {
  try {
    const response = await fetch(`/${MASTERS_KEY}`, { cache: "no-store" });
    if (response.status === 404) return;
    if (!response.ok) throw new Error(`定型文を取得できません（${response.status}）。`);
    const loaded = await response.json();
    if (!Array.isArray(loaded?.templates) || loaded.templates.some(tpl =>
      !tpl || typeof tpl.title !== "string" || typeof tpl.body !== "string")) throw new Error("定型文データの形式が不正です。");
    masters = loaded;
  } catch (error) {
    console.error("[message] templates load failed", error);
    element("template-edit").inert = true;
    element("add-template").disabled = true;
    element("save-templates").disabled = true;
    element("template-status").textContent = `${error.message} 定型文の編集には再読み込みが必要です。`;
    status(`${error.message} 定型文の編集には再読み込みが必要です。`, true);
  }
}
async function saveMasters() {
  const presign = await fetch(PRESIGN_URL, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: MASTERS_KEY, contentType: "application/json" }),
  });
  if (!presign.ok) throw new Error(`保存URLを取得できません（${presign.status}）。`);
  const { url } = await presign.json();
  const put = await fetch(url, { method: "PUT",
    body: JSON.stringify({ templates: masters.templates, updated_at: new Date().toISOString() }, null, 1),
    headers: { "Content-Type": "application/json" },
  });
  if (!put.ok) throw new Error(`保存に失敗しました（${put.status}）。`);
  status("定型文を保存しました。");
  await showSaveResult("定型文を保存しました。");
}
function payday(now) {
  const date = new Date(now.getFullYear(), now.getMonth() + 1, 5);
  const closed = day => day.getDay() === 0 || day.getDay() === 6
    || ["1/1", "1/2", "1/3", "5/3", "5/4", "5/5", "11/3"].includes(`${day.getMonth() + 1}/${day.getDate()}`);
  while (closed(date)) date.setDate(date.getDate() - 1);
  return `${date.getMonth() + 1}/${date.getDate()}(${WEEKDAYS[date.getDay()]})`;
}
function fillPlaceholders(text) {
  const now = new Date();
  const month = now.getMonth() + 1;
  return text.replaceAll("{年}", String(now.getFullYear())).replaceAll("{月}", String(month))
    .replaceAll("{来月}", String(month % 12 + 1)).replaceAll("{先月}", String((month + 10) % 12 + 1))
    .replaceAll("{翌月5日}", payday(now));
}
function renderTemplates() {
  element("template-list").innerHTML = masters.templates.map((tpl, index) =>
    `<div class="tpl"><h3>${escapeHtml(tpl.title)}</h3><pre>${escapeHtml(fillPlaceholders(tpl.body))}</pre><button type="button" class="primary-btn" data-tpl-copy="${index}">📋 コピー</button></div>`).join("");
}
function renderTemplateEditor() {
  element("template-edit").innerHTML = tplDraft.map((tpl, index) =>
    `<div class="tpl-edit"><input data-tpl="${index}" data-k="title" value="${escapeHtml(tpl.title)}" placeholder="タイトル"><textarea data-tpl="${index}" data-k="body" rows="6" placeholder="本文（{年}{月}{先月}{来月}{翌月5日} が使えます）">${escapeHtml(tpl.body)}</textarea><button type="button" class="del-tpl" data-tpl-del="${index}">この定型文を削除</button></div>`).join("");
}
window.addEventListener("DOMContentLoaded", async () => {
  if (!await verifyLocalAuth()) return;
  if (!["admin", "family"].includes(window.currentRole)) return;
  renderHeader({ adminPage: true });
  element("page-area").hidden = false;
  element("msg-date").value = initialMessageDate();
  syncWorkPlanLink();
  document.querySelectorAll(".msg-tab").forEach(button => button.addEventListener("click", () => {
    document.querySelectorAll(".msg-tab").forEach(tab => tab.classList.toggle("on", tab === button));
    for (const name of ["daily", "templates"]) element(`tab-${name}`).hidden = name !== button.dataset.tab;
  }));
  element("msg-login").onclick = () => login(`/admin/message/index.html?date=${element("msg-date").value}`);
  element("load-plans").onclick = loadSavedPlans;
  element("msg-date").onchange = loadSavedPlans;
  element("common-open").onclick = () => setCommonMode(!commonMode);
  element("common-all").onclick = () => selectCommonCards(true);
  element("common-clear").onclick = () => selectCommonCards(false);
  element("common-apply").onclick = applyCommonMessage;
  element("common-cancel").onclick = () => { setCommonMode(false); element("common-open").focus(); };
  element("cards").oninput = event => {
    if (event.target.dataset.preview) drafts.set(event.target.dataset.preview, event.target.value);
  };
  element("cards").onclick = handleCardClick;
  initLineMessaging({
    date: () => element("msg-date").value,
    groups: () => record ? messageGroups(record.data.plans, familyRecipientNames) : [],
    message: currentMessageText,
    check: async group => {
      if (!record || loadedDate !== element("msg-date").value) throw new Error("予定を再取得してください。");
      const issues = [...group.issues, ...group.entries.flatMap(({ plan }) => communicationIssues(plan))];
      if (issues.length) throw new Error(issues.join(" "));
      checkMessageGroup(group, (await fetchWorkPlanRecord(loadedDate)).data.plans);
    },
    lock: active => {
      copying = active;
      element("tab-daily").inert = active;
    },
    reload: async () => {
      record = await fetchWorkPlanRecord(loadedDate);
      renderCards();
    },
  });
  element("template-list").onclick = async event => {
    const button = event.target.closest("[data-tpl-copy]");
    if (!button) return;
    try {
      await copyText(fillPlaceholders(masters.templates[Number(button.dataset.tplCopy)].body));
      status("定型文をコピーしました（予定のコピー記録は作成しません）。");
    } catch (error) { console.error("[message] template copy failed", error); status(error.message, true); }
  };
  element("template-edit").oninput = event => {
    const index = Number(event.target.dataset.tpl);
    if (tplDraft[index]) tplDraft[index][event.target.dataset.k] = event.target.value;
  };
  element("template-edit").onclick = event => {
    const button = event.target.closest("[data-tpl-del]");
    if (button) { tplDraft.splice(Number(button.dataset.tplDel), 1); renderTemplateEditor(); }
  };
  element("add-template").onclick = () => { tplDraft.push({ title: "新しい定型文", body: "" }); renderTemplateEditor(); };
  element("save-templates").onclick = async () => {
    if (element("save-templates").disabled) return;
    element("save-templates").disabled = true;
    masters.templates = tplDraft.filter(tpl => tpl.title.trim() || tpl.body.trim());
    try { await saveMasters(); renderTemplates(); }
    catch (error) {
      console.error("[message] template save failed", error);
      status(error.message, true);
      await showSaveResult(`${error.message}\n入力は残しています。保存状態を確認してから再操作してください。`);
    } finally { element("save-templates").disabled = false; }
  };
  const plansLoading = loadSavedPlans(!new URLSearchParams(location.search).has("date"));
  await loadMasters();
  tplDraft = structuredClone(masters.templates);
  renderTemplates();
  renderTemplateEditor();
  await plansLoading;
});
