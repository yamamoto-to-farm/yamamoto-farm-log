import { verifyLocalAuth } from "/common/ui.js?v=1";
import { renderHeader } from "/common/header.js?v=1";
import { formatLocalYmd, parseDateInputLocal } from "/common/date-utils.js?v=1";
import { loadPlanWorkers, openPlanTaskModal } from "/common/work-plan-form.js?v=20261104-modal-1";
import { openWorkerSelectModal } from "/common/filter/filter-worker.js?v=20261104-modal-1";
import { fetchWorkPlanRecord, writeWorkPlan } from "/diary/planned-work.js?v=20261104-unified-1";
import { hasSession, login, ensureToken } from "/photos/auth.js?v=20261029-2";
import { config } from "/photos/config.js";
import { openFieldModal } from "/common/filter/filter-field.js?v=1";
import { getFilterData, setFilterData } from "/common/filter/filter-core.js?v=1";
import { applyAdjustments, defaultScenarioIndex, fitRemaining, toInputTime } from "/admin/shift/shift-logic.js?v=20261101-6";

const el = id => document.getElementById(id);
const escape = value => String(value ?? "").replace(/[&<>"']/g,
  char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const newBlock = () => ({ task: "", start: "", end: "", fields: [], field: "", shed: false });

export function createUnifiedPlan(family, parts, blocks, memo, reporter = "", off = false, reason = "", source = "direct") {
  const all = [...family, ...parts];
  if (!all.length || all.some(name => !name.trim()) || new Set(all).size !== all.length || all.length > 20) {
    throw new Error("作業者を重複なく1〜20人選択してください。");
  }
  const kind = family.length || !parts.length ? "1" : parts.length > 1 ? "2" : "3";
  if (!off && kind === "2" && !parts.includes(reporter)) throw new Error("連絡係をパートから選択してください。");
  if ((!off && !blocks.length) || blocks.length > 30) throw new Error("作業内容を1〜30件指定してください。");
  const validated = blocks.map(block => {
    if (!block.task.trim()) throw new Error("作業内容を入力してください。");
    if ((block.start || block.end) && (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(block.start)
      || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(block.end) || block.start >= block.end)) {
      throw new Error("時刻は開始・終了を両方入力し、終了を開始より後にしてください。");
    }
    return {
      task: block.task.trim(), start: block.start, end: block.end,
      fields: [...block.fields], field: "", shed: Boolean(block.shed),
      ...(parts.length && family.length ? { companions: (block.companions || family).filter(name => family.includes(name)) } : {}),
    };
  });
  return {
    source, names: parts.length ? [...parts] : [...family], recipients: [...parts],
    kind, reporter: kind === "2" ? reporter : "", off, off_reason: reason.trim(),
    blocks: validated, memo: memo.trim(), manual_text: false, message: "",
  };
}

let record;
let loadedDate = "";
let editingId = null;
let source = "direct";
let blocks = [newBlock()];
let workerMaster = [];
let selectedFamily = [];
let selectedParts = [];
let cleanSnapshot = "";
let sequence = 0;
let shiftSequence = 0;
let busy = false;
let shiftGroups = [];
const snapshot = () => JSON.stringify([selectedFamily, selectedParts, blocks, editingId,
  el("plan-memo").value, el("plan-reporter").value, el("plan-off").checked, el("plan-off-reason").value]);
const canDiscard = () => snapshot() === cleanSnapshot || confirm("入力中の予定を破棄しますか？");
function notice(message, error = false) {
  el("status").textContent = message;
  el("status").classList.toggle("error", error);
  el("plan-login").hidden = hasSession();
}
function renderWorkers() {
  el("plan-workers").textContent = selectedFamily.join(" / ") || "未選択";
  el("plan-parts").textContent = selectedParts.join(" / ") || "未選択";
  el("participant-kind").textContent = selectedFamily.length
    ? selectedParts.length ? "家族とパート（LINE報告なし）" : "家族・自分のみ"
    : selectedParts.length > 1 ? "パートのみ（連絡係を指定）" : selectedParts.length ? "パート1人（本人が報告）" : "作業者を選択してください。";
  const reporter = el("plan-reporter").value;
  el("plan-reporter").innerHTML = '<option value="">連絡係を選択</option>' + selectedParts.map(name =>
    `<option value="${escape(name)}">${escape(name)}</option>`).join("");
  el("plan-reporter").value = selectedParts.includes(reporter) ? reporter : selectedParts[0] || "";
  el("plan-reporter").disabled = Boolean(selectedFamily.length || selectedParts.length < 2);
}
function renderBlocks() {
  el("plan-blocks").innerHTML = blocks.map((block, index) => `<fieldset class="plan-block">
    <legend>作業 ${index + 1}</legend>
    <button type="button" class="secondary-btn" data-task="${index}">作業内容を選択</button>
    <p>${escape(block.task || "未選択")}</p>
    <label>作業内容（自由入力・修正）<input class="form-input" data-block="${index}" data-key="task" value="${escape(block.task)}" maxlength="200"></label>
    <details${block.start || block.fields.length || block.shed ? " open" : ""}><summary>時間・圃場（任意）</summary>
      <label>開始 <input type="time" class="form-input" data-block="${index}" data-key="start" value="${escape(block.start)}"></label>
      <label>終了 <input type="time" class="form-input" data-block="${index}" data-key="end" value="${escape(block.end)}"></label>
      <label><input type="checkbox" data-block="${index}" data-key="shed"${block.shed ? " checked" : ""}>作業場集合</label>
      <button type="button" class="secondary-btn" data-field="${index}">圃場を追加（複数可）</button>
      <div>${block.fields.map((field, target) => `<button type="button" class="secondary-btn" data-remove-field="${index}" data-field-index="${target}">${escape(field)} ×</button>`).join("")}</div>
    </details>
    ${selectedFamily.length && selectedParts.length ? `<p>この作業に参加する家族：${escape((block.companions || selectedFamily).join("・") || "なし")}</p><button type="button" class="secondary-btn" data-companions="${index}">この作業の家族を選択</button>` : ""}
    ${blocks.length > 1 ? `<button type="button" class="secondary-btn" data-remove-block="${index}">この作業を削除</button>` : ""}
  </fieldset>`).join("");
}
function clearForm() {
  el("plan-form").reset();
  selectedFamily = [];
  selectedParts = [];
  blocks = [newBlock()];
  editingId = null;
  source = "direct";
  renderWorkers();
  renderBlocks();
  el("editing-label").textContent = "新しい予定";
  cleanSnapshot = snapshot();
}
function hasSentCommunication(id, plan) {
  return plan.last_communication?.status === "sent"
    || record.data.communications.some(item => item.plan_id === id && item.status === "sent");
}
function renderSaved() {
  const plans = Object.entries(record.data.plans);
  el("saved-plans").innerHTML = plans.length ? plans.map(([id, plan]) => {
    const participants = [...new Set([...plan.names, ...plan.blocks.flatMap(block => block.companions || [])])];
    const sent = hasSentCommunication(id, plan);
    return `<article class="saved-plan"><h3>${escape(participants.join("・"))}</h3>
      <p class="plan-note">${plan.last_communication ? `${sent ? "送信済み" : "連絡用にコピー済み"}${plan.communication_changed ? "・連絡後に変更あり" : ""}` : "連絡前"}</p>
      ${plan.off ? `<p>中止${plan.off_reason ? `：${escape(plan.off_reason)}` : ""}</p>` : ""}
      ${plan.blocks.map(block => `<p>${block.start && block.end ? `${escape(block.start)}〜${escape(block.end)}　` : ""}${escape(block.task)}${block.fields?.length || block.field ? `｜${escape((block.fields || [block.field]).join("・"))}` : ""}</p>`).join("")}
      ${plan.memo ? `<p>${escape(plan.memo)}</p>` : ""}
      <div class="plan-actions"><button type="button" class="secondary-btn" data-edit="${escape(id)}">編集</button>
        <button type="button" class="secondary-btn" data-off="${escape(id)}">${plan.off ? "中止を解除" : "中止にする"}</button>
        <button type="button" class="secondary-btn" data-delete="${escape(id)}"${sent ? " disabled" : ""}>削除</button>
        <a class="secondary-btn" href="/admin/message/index.html?date=${loadedDate}">連絡文を開く</a></div>
    </article>`;
  }).join("") : "<p>この日の予定は保存されていません。</p>";
  el("communication-history").innerHTML = record.data.communications.length ? [...record.data.communications].reverse().map(item =>
    `<article class="saved-plan"><p>${escape(item.at)} ${item.status === "sent" ? "送信済み" : "連絡用にコピー済み"} → ${escape(item.recipients.join("・"))}</p>
      <details><summary>連絡時点の予定・文面</summary><p>${escape(item.plan.names.join("・"))}${item.plan.off ? "（中止）" : ""}</p>
      ${item.plan.blocks.map(block => `<p>${block.start && block.end ? `${escape(block.start)}〜${escape(block.end)}　` : ""}${escape(block.task)}${block.fields?.length || block.field ? `｜${escape((block.fields || [block.field]).join("・"))}` : ""}${block.companions?.length ? `（共同作業：${escape(block.companions.join("・"))}）` : ""}</p>`).join("")}
      <pre>${escape(item.message)}</pre></details></article>`).join("") : "<p>連絡の控えはありません。</p>";
}
async function loadDay(preferredId = null) {
  const current = ++sequence;
  ++shiftSequence;
  const date = el("plan-date").value;
  record = null;
  loadedDate = date;
  clearForm();
  el("plan-inputs").disabled = true;
  el("saved-plans").replaceChildren();
  el("saved-plans").inert = true;
  el("communication-history").replaceChildren();
  el("shift-candidates").replaceChildren();
  el("shift-state").textContent = "";
  el("message-link").href = `/admin/message/index.html?date=${date}`;
  el("work-plan-link").href = `/schedule/work-plan/index.html?ym=${date.slice(0, 7)}`;
  notice("予定を読み込み中…");
  try {
    const [result, workers, response] = await Promise.all([
      fetchWorkPlanRecord(date), loadPlanWorkers(), fetch("/data/fields.json", { cache: "no-store" }),
    ]);
    if (current !== sequence) return;
    if (!Object.hasOwn(result, "revision") || (result.revision !== null && typeof result.revision !== "string")
      || !result.data.plans || !Array.isArray(result.data.communications)) throw new Error("予定APIの更新が必要です。新しいLambdaを公開してください。");
    if (!response.ok) throw new Error(`圃場を取得できません（${response.status}）。`);
    const rows = await response.json();
    if (current !== sequence) return;
    if (!Array.isArray(rows)) throw new Error("圃場データの形式が不正です。");
    const children = Object.create(null);
    for (const row of rows) if (row.area && row.name) (children[row.area] ||= []).push(row.name);
    setFilterData({ ...(getFilterData() || {}), fields: { parents: Object.keys(children), children } });
    workerMaster = workers;
    record = result;
    clearForm();
    renderSaved();
    el("saved-plans").inert = false;
    el("plan-inputs").disabled = false;
    notice("");
    if (typeof preferredId === "string" && record.data.plans[preferredId]) editPlan(preferredId);
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
  try {
    await writeWorkPlan({ date: loadedDate, revision: record.revision, ...request });
    await loadDay();
    notice(record ? "予定を保存しました。" : "保存済みですが、再取得できません。再読み込みしてください。", !record);
  } catch (error) {
    console.error("[daily-plan] save failed", error);
    record = null;
    el("plan-inputs").disabled = true;
    el("saved-plans").inert = true;
    notice(`${error.message} 保存状態を確認するため「再読み込み」を押してください。`, true);
  } finally { busy = false; el("page-area").inert = false; }
}
function editPlan(id) {
  if (!canDiscard()) return;
  const plan = record.data.plans[id];
  clearForm();
  editingId = id;
  source = plan.source;
  const partNames = new Set(workerMaster.filter(worker => worker.role === "worker").map(worker => worker.display));
  const all = [...new Set([...plan.names, ...plan.blocks.flatMap(block => block.companions || [])])];
  selectedFamily = all.filter(name => !partNames.has(name));
  selectedParts = all.filter(name => partNames.has(name));
  blocks = plan.blocks.map(block => ({ ...structuredClone(block), fields: block.fields ? [...block.fields] : block.field ? [block.field] : [] }));
  renderWorkers();
  renderBlocks();
  el("plan-reporter").value = plan.reporter || selectedParts[0] || "";
  el("plan-memo").value = plan.memo || "";
  el("plan-off").checked = plan.off;
  el("plan-off-reason").value = plan.off_reason || "";
  el("editing-label").textContent = "保存済み予定を編集";
  cleanSnapshot = snapshot();
  el("plan-form").scrollIntoView({ block: "start" });
}
async function shiftApi(path, query = {}, method = "GET") {
  const token = await ensureToken();
  if (!token) throw new Error("シフト読込にはログインが必要です。");
  const response = await fetch(`${config.api}${path}${method === "GET" ? `?${new URLSearchParams(query)}` : ""}`, {
    method, cache: "no-store",
    headers: { Authorization: `Bearer ${token}`, ...(method === "POST" ? { "Content-Type": "application/json" } : {}) },
    ...(method === "POST" ? { body: JSON.stringify(query) } : {}),
  });
  if (response.status === 404 && path === "/shift/edits") return { overrides: {}, base: null, autofit: false };
  if (!response.ok) throw new Error(`シフトを取得できません（${response.status}）。`);
  return response.json();
}
async function loadShift() {
  const current = ++shiftSequence;
  const date = el("plan-date").value;
  el("shift-candidates").replaceChildren();
  el("shift-state").textContent = "シフトを読み込み中…";
  try {
    const [plan, edits] = await Promise.all([shiftApi("/shift/plan", { month: date.slice(0, 7) }), shiftApi("/shift/edits", { month: date.slice(0, 7) })]);
    if (current !== shiftSequence || date !== el("plan-date").value) return;
    const scenario = plan.scenarios[defaultScenarioIndex(plan)];
    let items = applyAdjustments(plan, scenario, edits.overrides || {}, edits.base || null);
    if (edits.autofit) items = fitRemaining(plan, items, scenario.budget_max, edits.base || null).items;
    const groups = new Map();
    for (const item of items.filter(item => item.date === date && !["hold", "skip"].includes(item.status) && item.proposed_hours > 0)) {
      const start = toInputTime(item.start || ""), end = toInputTime(item.proposed_end || "");
      const key = `${start}|${end}`;
      if (!groups.has(key)) groups.set(key, { names: [], start, end });
      groups.get(key).names.push(item.person);
    }
    shiftGroups = [...groups.values()];
    el("shift-candidates").innerHTML = shiftGroups.map((group, index) =>
      `<button type="button" class="secondary-btn" data-shift-group="${index}">${escape(group.names.join("・"))} ${escape(group.start)}〜${escape(group.end)} を予定入力へ</button>`).join("");
    el("shift-state").textContent = `${shiftGroups.length}グループ。選択後に作業を指定して保存してください（保存済み予定は自動変更しません）。${plan.generated_at ? ` データ：${plan.generated_at}` : ""}`;
  } catch (error) {
    if (current !== shiftSequence) return;
    console.error("[daily-plan] shift load failed", error);
    notice(error.message, true);
    el("shift-state").textContent = "シフト読込に失敗しました。再度読み込んでください。";
  }
}
async function refreshShift() {
  if (busy || !confirm("TimeTreeの最新データでシフトを再計算しますか？（約1〜2分）")) return;
  const date = el("plan-date").value;
  busy = true;
  el("page-area").inert = true;
  try {
    const before = await shiftApi("/shift/plan", { month: date.slice(0, 7) });
    await shiftApi("/shift/regenerate", { month: date.slice(0, 7) }, "POST");
    el("shift-state").textContent = "TimeTreeから再取得中…";
    const deadline = Date.now() + 120000;
    let ready = false;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 10000));
      const latest = await shiftApi("/shift/plan", { month: date.slice(0, 7) });
      if (latest.generated_at && latest.generated_at !== before.generated_at) { ready = true; break; }
    }
    if (!ready) throw new Error("再取得の完了を確認できません。時間をおいてシフトを読み込んでください。");
    await loadShift();
  } catch (error) { console.error("[daily-plan] regenerate failed", error); notice(error.message, true); }
  finally { busy = false; el("page-area").inert = false; }
}
window.addEventListener("DOMContentLoaded", async () => {
  if (!await verifyLocalAuth() || !["admin", "family"].includes(window.currentRole)) return;
  renderHeader();
  el("page-area").hidden = false;
  clearForm();
  const params = new URLSearchParams(location.search);
  const requested = params.get("date"), parsed = parseDateInputLocal(requested);
  el("plan-date").value = requested && parsed && formatLocalYmd(parsed) === requested ? requested : formatLocalYmd(new Date());
  el("select-family").onclick = () => openWorkerSelectModal({
    workers: workerMaster.filter(worker => ["admin", "family"].includes(worker.role)), selected: selectedFamily,
    title: "作業者の選択（家族・自分）", onApply: names => {
      selectedFamily = names;
      blocks.forEach(block => { if (block.companions) block.companions = block.companions.filter(name => names.includes(name)); });
      renderWorkers(); renderBlocks();
    },
  });
  el("select-parts").onclick = () => openWorkerSelectModal({
    workers: workerMaster.filter(worker => worker.role === "worker" && worker.employmentStatus !== "retired"),
    selected: selectedParts, title: "作業者の選択（パート）",
    onApply: names => { selectedParts = names; renderWorkers(); renderBlocks(); },
  });
  el("add-block").onclick = () => { blocks.push(newBlock()); renderBlocks(); };
  el("plan-blocks").oninput = event => {
    const index = Number(event.target.dataset.block);
    if (!blocks[index] || !event.target.dataset.key) return;
    blocks[index][event.target.dataset.key] = event.target.type === "checkbox" ? event.target.checked : event.target.value;
  };
  el("plan-blocks").onclick = event => {
    const task = event.target.closest("[data-task]");
    if (task) openPlanTaskModal({ selected: blocks[Number(task.dataset.task)].task, onSelect: value => {
      blocks[Number(task.dataset.task)].task = value === "__custom__" ? "" : value;
      renderBlocks();
      if (value === "__custom__") el("plan-blocks").querySelector(`[data-block="${task.dataset.task}"][data-key="task"]`).focus();
    } });
    const field = event.target.closest("[data-field]");
    if (field) openFieldModal({ mode: "select", selectWithConfirm: true, onSelect: name => {
      const block = blocks[Number(field.dataset.field)];
      if (name && !block.fields.includes(name)) block.fields.push(name);
      renderBlocks();
    } });
    const removeField = event.target.closest("[data-remove-field]");
    if (removeField) { blocks[Number(removeField.dataset.removeField)].fields.splice(Number(removeField.dataset.fieldIndex), 1); renderBlocks(); }
    const removeBlock = event.target.closest("[data-remove-block]");
    if (removeBlock) { blocks.splice(Number(removeBlock.dataset.removeBlock), 1); renderBlocks(); }
    const companions = event.target.closest("[data-companions]");
    if (companions) {
      const block = blocks[Number(companions.dataset.companions)];
      openWorkerSelectModal({ workers: selectedFamily.map(display => ({ display })), selected: block.companions || selectedFamily,
        onApply: names => { block.companions = names; renderBlocks(); } });
    }
  };
  el("cancel-edit").onclick = () => { if (canDiscard()) clearForm(); };
  el("reload").onclick = () => { if (canDiscard()) return loadDay(); };
  el("plan-login").onclick = () => login(`/schedule/daily-plan/index.html?date=${el("plan-date").value}`);
  el("plan-date").onchange = () => {
    if (!el("plan-date").value || !canDiscard()) { el("plan-date").value = loadedDate; return; }
    return loadDay();
  };
  el("load-shift").onclick = loadShift;
  el("refresh-shift").onclick = refreshShift;
  el("shift-candidates").onclick = event => {
    const button = event.target.closest("[data-shift-group]");
    if (!button || !canDiscard() || !record) return;
    const group = shiftGroups[Number(button.dataset.shiftGroup)];
    clearForm();
    selectedParts = [...group.names];
    blocks[0].start = group.start; blocks[0].end = group.end;
    renderWorkers(); renderBlocks();
  };
  el("plan-form").onsubmit = async event => {
    event.preventDefault();
    try {
      const plan = createUnifiedPlan(selectedFamily, selectedParts, blocks, el("plan-memo").value,
        el("plan-reporter").value, el("plan-off").checked, el("plan-off-reason").value, source);
      await saveRequest({ plan, ...(editingId ? { id: editingId } : {}) });
    } catch (error) { console.error("[daily-plan] invalid input", error); notice(error.message, true); }
  };
  el("saved-plans").onclick = event => {
    if (!record) return;
    const edit = event.target.closest("[data-edit]");
    if (edit) editPlan(edit.dataset.edit);
    const remove = event.target.closest("[data-delete]");
    if (remove && canDiscard()) {
      const plan = record.data.plans[remove.dataset.delete];
      if (hasSentCommunication(remove.dataset.delete, plan)) { notice("送信済みの予定は削除できません。中止・変更してください。", true); return; }
      const copied = Boolean(plan.last_communication);
      if (confirm(copied ? "連絡用にコピー済みです。送った内容と食い違う可能性があります。この予定を削除しますか？連絡時点の控えは残ります。" : "この予定を削除しますか？他の予定は残ります。")) {
        return saveRequest({ id: remove.dataset.delete, operation: "delete", confirm_copied: copied });
      }
    }
    const off = event.target.closest("[data-off]");
    if (off && canDiscard()) {
      const plan = record.data.plans[off.dataset.off];
      if (confirm(plan.off ? "この予定の中止を解除しますか？" : "予定を残して中止にしますか？必要に応じて再連絡してください。")) {
        return saveRequest({ id: off.dataset.off, plan: { ...plan, off: !plan.off, off_reason: plan.off_reason || "作業の都合により" } });
      }
    }
  };
  window.addEventListener("beforeunload", event => {
    if (!busy && snapshot() !== cleanSnapshot) { event.preventDefault(); event.returnValue = ""; }
  });
  await loadDay(params.get("id"));
});
