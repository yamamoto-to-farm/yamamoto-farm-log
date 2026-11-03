import { verifyLocalAuth } from "/common/ui.js?v=1";
import { renderHeader } from "/common/header.js?v=1";
import { formatLocalYmd, parseDateInputLocal } from "/common/date-utils.js?v=1";
import { loadFamilyWorkers } from "/common/work-plan-form.js?v=20261104-1";
import { fetchWorkPlanRecord, writeWorkPlan } from "/diary/planned-work.js?v=20261104-family-1";
import { hasSession, login } from "/photos/auth.js?v=20261029-2";
import { openFieldModal } from "/common/filter/filter-field.js?v=1";
import { getFilterData, setFilterData } from "/common/filter/filter-core.js?v=1";

const el = id => document.getElementById(id);
const escape = value => String(value ?? "").replace(/[&<>"']/g,
  char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

export function createDirectPlan(names, task, fields, start, end, memo) {
  names = names.map(name => String(name).trim());
  task = task.trim();
  if (!names.length || names.some(name => !name) || new Set(names).size !== names.length || !task) {
    throw new Error("担当者と作業内容を入力してください。");
  }
  if ((start || end) && (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(start)
    || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(end) || start >= end)) {
    throw new Error("時刻は開始・終了を両方入力し、終了を開始より後にしてください。");
  }
  return {
    source: "direct", names, kind: "1", off: false, manual_text: false, message: "",
    reporter: "", off_reason: "", memo: memo.trim(),
    blocks: [{ task, fields: [...new Set(fields)], field: "", start, end, shed: false }],
  };
}

let fields = [];
let record;
let loadedDate = "";
let editingId = null;
let cleanSnapshot = "";
let sequence = 0;
let busy = false;
const notice = (message, error = false) => {
  el("status").textContent = message;
  el("status").classList.toggle("error", error);
  el("plan-login").hidden = hasSession();
};
const inputNames = () => Array.from(el("plan-workers").querySelectorAll("input:checked"), input => input.value);
const snapshot = () => JSON.stringify([inputNames(), el("plan-task").value, el("custom-task").value,
  el("plan-start").value, el("plan-end").value, el("plan-memo").value, fields, editingId]);
const canDiscard = () => snapshot() === cleanSnapshot || confirm("入力中の予定を破棄しますか？");
function renderFields() {
  el("plan-fields").innerHTML = fields.map((field, index) =>
    `<button type="button" class="secondary-btn" data-remove-field="${index}">${escape(field)} ×</button>`).join("");
}
function clearForm() {
  el("plan-form").reset();
  fields = [];
  editingId = null;
  renderFields();
  el("editing-label").textContent = "新しい予定";
  el("custom-task-label").hidden = true;
  cleanSnapshot = snapshot();
}
function renderSaved() {
  const plans = Object.entries(record.data.plans);
  el("saved-plans").innerHTML = plans.length ? plans.map(([id, plan]) => `
    <article class="saved-plan"><h3>${escape(plan.names.join("・"))}</h3>
      <small>${plan.source === "direct" ? "直接入力" : "業務連絡（この画面では編集しません）"}</small>
      ${plan.off ? "<p>中止の連絡</p>" : plan.blocks.map(block => {
        const targets = Array.isArray(block.fields) ? block.fields.join("・") : block.field;
        return `<p>${block.start && block.end ? `${escape(block.start)}〜${escape(block.end)}　` : ""}${escape(block.task)}${targets ? `｜${escape(targets)}` : ""}${block.companions?.length ? `（一緒に作業：${escape(block.companions.join("・"))}）` : ""}</p>`;
      }).join("")}
      ${plan.memo ? `<p>${escape(plan.memo)}</p>` : ""}
      ${plan.source === "direct" ? `<div class="plan-actions"><button type="button" class="secondary-btn" data-edit="${escape(id)}">編集</button><button type="button" class="secondary-btn" data-delete="${escape(id)}">削除</button></div>` : ""}
    </article>`).join("") : "<p>この日の予定は保存されていません。</p>";
}
async function loadDay() {
  const current = ++sequence;
  const date = el("plan-date").value;
  record = null;
  loadedDate = date;
  clearForm();
  el("plan-inputs").disabled = true;
  el("saved-plans").replaceChildren();
  el("saved-plans").inert = true;
  el("message-link").href = `/admin/message/index.html?date=${date}`;
  notice("予定を読み込み中…");
  try {
    const [result, workers, response] = await Promise.all([
      fetchWorkPlanRecord(date), loadFamilyWorkers(), fetch("/data/fields.json", { cache: "no-store" }),
    ]);
    if (current !== sequence) return;
    if (!Object.hasOwn(result, "revision") || (result.revision !== null && typeof result.revision !== "string")
      || !result.data.plans || Array.isArray(result.data.plans) || typeof result.data.plans !== "object") {
      throw new Error("予定APIの更新が必要です。新しいLambdaを公開してください。");
    }
    if (!response.ok) throw new Error(`圃場を取得できません（${response.status}）。`);
    const fieldRows = await response.json();
    if (current !== sequence) return;
    if (!Array.isArray(fieldRows)) throw new Error("圃場データの形式が不正です。");
    const children = Object.create(null);
    for (const row of fieldRows) {
      if (row.area && row.name) (children[row.area] ||= []).push(row.name);
    }
    setFilterData({ ...(getFilterData() || {}), fields: { parents: Object.keys(children), children } });
    el("plan-workers").innerHTML = workers.map(name =>
      `<label><input type="checkbox" value="${escape(name)}">${escape(name)}</label>`).join("");
    record = result;
    loadedDate = date;
    clearForm();
    renderSaved();
    el("saved-plans").inert = false;
    el("plan-inputs").disabled = false;
    notice("");
  } catch (error) {
    if (current !== sequence) return;
    console.error("[daily-plan] load failed", error);
    notice(`${error.message}「再読み込み」で再試行してください。`, true);
  }
}
async function saveRequest(request) {
  if (busy || !record || loadedDate !== el("plan-date").value) return;
  busy = true;
  el("page-area").inert = true;
  let saved = false;
  try {
    await writeWorkPlan({ date: loadedDate, revision: record.revision, ...request });
    saved = true;
    await loadDay();
    if (record) notice("予定を保存しました。");
    else notice("予定は保存済みですが、再取得できません。「再読み込み」で確認してください。", true);
  } catch (error) {
    console.error("[daily-plan] save failed", error);
    record = null;
    el("plan-inputs").disabled = true;
    el("saved-plans").inert = true;
    notice(`${saved ? "保存後の確認に失敗しました。" : ""}${error.message} 保存状態を確認するため「再読み込み」を押してください。`, true);
  } finally {
    busy = false;
    el("page-area").inert = false;
  }
}
function editPlan(id) {
  if (!canDiscard()) return;
  const plan = record.data.plans[id];
  if (plan.source !== "direct") return;
  if (plan.blocks.length !== 1) {
    notice("この予定は複数の作業を含むため、この画面では編集できません。", true);
    return;
  }
  clearForm();
  editingId = id;
  const block = plan.blocks[0];
  for (const name of plan.names) {
    let checkbox = Array.from(el("plan-workers").querySelectorAll("input")).find(input => input.value === name);
    if (!checkbox) {
      const label = document.createElement("label");
      checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = name;
      label.append(checkbox, document.createTextNode(name));
      el("plan-workers").append(label);
    }
    checkbox.checked = true;
  }
  const known = Array.from(el("plan-task").options).some(option => option.value === block.task);
  el("plan-task").value = known ? block.task : "__custom__";
  el("custom-task").value = known ? "" : block.task;
  el("custom-task-label").hidden = known;
  el("plan-start").value = block.start || "";
  el("plan-end").value = block.end || "";
  el("plan-memo").value = plan.memo || "";
  fields = Array.isArray(block.fields) ? [...block.fields] : block.field ? [block.field] : [];
  renderFields();
  el("editing-label").textContent = "保存済み予定を編集";
  el("plan-form").querySelector("details").open = Boolean(fields.length || block.start || plan.memo);
  cleanSnapshot = snapshot();
  el("plan-form").scrollIntoView({ block: "start" });
}
window.addEventListener("DOMContentLoaded", async () => {
  if (!await verifyLocalAuth()) return;
  if (!["admin", "family"].includes(window.currentRole)) return;
  renderHeader();
  el("page-area").hidden = false;
  clearForm();
  const requested = new URLSearchParams(location.search).get("date");
  const parsed = parseDateInputLocal(requested);
  el("plan-date").value = requested && parsed && formatLocalYmd(parsed) === requested
    ? requested : formatLocalYmd(new Date());
  el("plan-task").addEventListener("change", () => { el("custom-task-label").hidden = el("plan-task").value !== "__custom__"; });
  el("cancel-edit").onclick = () => { if (canDiscard()) clearForm(); };
  el("reload").onclick = () => { if (canDiscard()) return loadDay(); };
  el("plan-login").onclick = () => login(`/schedule/daily-plan/index.html?date=${el("plan-date").value}`);
  el("plan-date").addEventListener("change", () => {
    if (!el("plan-date").value || !canDiscard()) { el("plan-date").value = loadedDate; return; }
    return loadDay();
  });
  el("add-field").onclick = () => openFieldModal({
    mode: "select", selectWithConfirm: true,
    onSelect: name => { if (name && !fields.includes(name)) fields.push(name); renderFields(); },
  });
  el("plan-fields").onclick = event => {
    const button = event.target.closest("[data-remove-field]");
    if (button) { fields.splice(Number(button.dataset.removeField), 1); renderFields(); }
  };
  el("plan-form").addEventListener("submit", async event => {
    event.preventDefault();
    try {
      const task = el("plan-task").value === "__custom__" ? el("custom-task").value : el("plan-task").value;
      const plan = createDirectPlan(inputNames(), task, fields, el("plan-start").value, el("plan-end").value, el("plan-memo").value);
      await saveRequest({ plan, ...(editingId ? { id: editingId } : {}) });
    } catch (error) {
      console.error("[daily-plan] invalid input", error);
      notice(error.message, true);
    }
  });
  el("saved-plans").onclick = event => {
    const edit = event.target.closest("[data-edit]");
    if (edit && record) editPlan(edit.dataset.edit);
    const remove = event.target.closest("[data-delete]");
    if (remove && record && canDiscard() && confirm("この予定を削除しますか？他の作業予定は残ります。")) {
      return saveRequest({ id: remove.dataset.delete, operation: "delete" });
    }
  };
  window.addEventListener("beforeunload", event => {
    if (!busy && snapshot() !== cleanSnapshot) { event.preventDefault(); event.returnValue = ""; }
  });
  await loadDay();
});
