import { verifyLocalAuth } from "/common/ui.js?v=1";
import { renderHeader } from "/common/header.js?v=1";
import { formatLocalYmd, parseDateInputLocal } from "/common/date-utils.js?v=1";
import { loadPlanWorkers, openPlanTaskModal } from "/common/work-plan-form.js?v=20261104-modal-1";
import { openWorkerSelectModal } from "/common/filter/filter-worker.js?v=20261104-work-1";
import { fetchWorkPlanRecord, writeWorkPlan } from "/diary/planned-work.js?v=20261104-time-1";
import { availableWorkTimes, participationForWork, mergeTimeRanges, validTimeRange } from "/common/work-plan-time.js?v=20261104-mixed-time-1";
import { hasSession, login, ensureToken } from "/photos/auth.js?v=20261029-2";
import { config } from "/photos/config.js";
import { openFieldModal } from "/common/filter/filter-field.js?v=1";
import { getFilterData, setFilterData } from "/common/filter/filter-core.js?v=1";
import { applyAdjustments, defaultScenarioIndex, fitRemaining, toInputTime } from "/admin/shift/shift-logic.js?v=20261101-6";

const el = id => document.getElementById(id);
const escape = value => String(value ?? "").replace(/[&<>"']/g,
  char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const newBlock = () => ({ task: "", start: "", end: "", fields: [], field: "", shed: false });

export function createUnifiedPlan(family, parts, blocks, memo, reporter = "", off = false, reason = "", source = "direct", attendance = null) {
  const all = [...family, ...parts];
  if (!all.length || all.some(name => !name.trim()) || new Set(all).size !== all.length || all.length > 20) {
    throw new Error("作業者を重複なく1〜20人選択してください。");
  }
  const kind = family.length || !parts.length ? "1" : parts.length > 1 ? "2" : "3";
  if (!off && kind === "2" && !parts.includes(reporter)) throw new Error("連絡係をパートから選択してください。");
  if ((!off && !blocks.length) || blocks.length > 30) throw new Error("作業内容を1〜30件指定してください。");
  const timed = parts.length && attendance && blocks.every(block => block.participation
    && Object.keys(block.participation).length === parts.length && parts.every(name => block.participation[name]?.length));
  if (parts.length && attendance && !off && !timed) throw new Error("各パートの作業参加時間を確認してください。");
  const validated = blocks.map(block => {
    if (!block.task.trim()) throw new Error("作業内容を入力してください。");
    if ((block.start || block.end) && (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(block.start)
      || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(block.end) || block.start >= block.end)) {
      throw new Error("時刻は開始・終了を両方入力し、終了を開始より後にしてください。");
    }
    return {
      task: block.task.trim(), start: block.start, end: block.end,
      fields: [...block.fields], field: "", shed: Boolean(block.shed),
      ...(timed ? { participation: structuredClone(block.participation) } : {}),
      ...(parts.length && family.length ? { companions: (block.companions || family).filter(name => family.includes(name)) } : {}),
    };
  });
  return {
    source, names: parts.length ? [...parts] : [...family], recipients: [...parts],
    kind, reporter: kind === "2" ? reporter : "", off, off_reason: reason.trim(),
    blocks: validated, memo: memo.trim(), manual_text: false, message: "",
    ...(timed ? { attendance: Object.fromEntries(parts.map(name => [name, attendance[name]])) } : {}),
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
let shiftEligible = null;
let shiftReady = false;
let cleanSnapshot = "";
let sequence = 0;
let shiftSequence = 0;
let busy = false;
let shiftGroups = [];
let inputScope = "family";
let noonBreak = null;
let savedAttendance = {};
const attendanceForSelection = () => Object.fromEntries(selectedParts.map(name => {
  const ranges = shiftReady ? shiftGroups.filter(group => group.names.includes(name)).map(({ start, end }) => ({ start, end }))
    : savedAttendance[name] || [];
  return [name, mergeTimeRanges(ranges)];
}));
function blockAvailability(index) {
  return availableWorkTimes(selectedParts, attendanceForSelection(), record.data.plans, editingId,
    blocks.filter((_, other) => other !== index), noonBreak);
}
function blockFamily(block) {
  return (block.companions || selectedFamily).filter(name => selectedFamily.includes(name));
}
function initializeWorkTime() {
  if (!selectedParts.length || !shiftReady || !record) return;
  for (let index = 0; index < blocks.length; index++) {
    if (blocks[index].start || blocks[index].end) continue;
    const availability = blockAvailability(index);
    if (availability.candidates.length === 1) Object.assign(blocks[index], availability.candidates[0]);
  }
}
const snapshot = () => JSON.stringify([selectedFamily, selectedParts, blocks, editingId,
  el("plan-memo").value, el("plan-reporter").value, el("plan-off").checked, el("plan-off-reason").value, el("plan-kind").value]);
const canDiscard = () => snapshot() === cleanSnapshot || confirm("入力中の予定を破棄しますか？");
const activeParts = () => workerMaster.filter(worker => worker.role === "worker" && worker.employmentStatus !== "retired");
const selectableParts = () => activeParts().filter(worker => shiftEligible === null || shiftEligible.has(worker.display));
const inferKind = () => selectedFamily.length ? selectedParts.length ? "mixed" : "family"
  : selectedParts.length > 1 ? "parts" : "single";
export function workerAssignments(name, plans) {
  return Object.entries(plans).flatMap(([id, plan]) => plan.off ? [] : plan.blocks
    .filter(block => plan.names.includes(name) || (block.companions || []).includes(name))
    .flatMap(block => block.participation?.[name]
      ? block.participation[name].map(range => ({ id, task: block.task, ...range }))
      : [{ id, task: block.task, start: block.start, end: block.end }]));
}
function renderUnplannedParts() {
  const missing = record && shiftEligible !== null ? selectableParts()
    .filter(worker => !workerAssignments(worker.display, record.data.plans).length).map(worker => worker.display) : [];
  el("unplanned-parts").textContent = !shiftReady ? "シフト読込後、出勤パートの作業予定の登録有無を確認します。"
    : !shiftEligible.size ? "この日の出勤パートはありません。"
    : missing.length ? `${missing.join("・")}は作業予定がありません（中止を除く）。`
      : "出勤パートの作業予定は登録済みです（時間の充足は判定しません）。";
}
function renderScope() {
  el("plan-scope").value = inputScope;
  const mode = el("plan-kind").value;
  const options = (inputScope === "family" ? [["family", "①家族のみ"], ["mixed", "②家族＋パート"]]
    : [["mixed", "②家族＋パート"], ["parts", "③パート複数"], ["single", "④パート１人"]])
    .filter(([value]) => value !== "parts" || !shiftReady || shiftEligible.size >= 2);
  el("plan-kind").innerHTML = '<option value="">作業形態を選択</option>' + options.map(([value, label]) =>
    `<option value="${value}">${label}</option>`).join("");
  el("plan-kind").value = options.some(([value]) => value === mode) ? mode
    : mode === "parts" && inputScope === "parts" && shiftReady && shiftEligible.size === 1
      && !selectedFamily.length && selectedParts.length <= 1 ? "single" : inputScope === "family" ? "family" : "";
}
export function resolveShiftWorker(person, staff, workers) {
  const normalize = value => String(value || "").normalize("NFKC").replace(/\s/g, "");
  const member = staff.find(member => member.name === person);
  const candidates = member?.login ? workers.filter(worker => worker.name === member.login)
    : workers.filter(worker => normalize(worker.display) === normalize(person)
      || normalize(worker.name) === normalize(person)
      || String(worker.display || "").normalize("NFKC").trim().split(/\s+/)[0] === String(person).normalize("NFKC"));
  if (candidates.length !== 1 || !candidates[0].display) {
    throw new Error(`「${person}」のパート従業員を一意に特定できません。シフト設定のログイン連携を確認してください。`);
  }
  return candidates[0].display;
}
function validateParticipants() {
  const mode = el("plan-kind").value;
  if (!mode) throw new Error("作業形態を選択してください。");
  if ((mode === "family" && (!selectedFamily.length || selectedParts.length))
    || (mode === "mixed" && (!selectedFamily.length || !selectedParts.length))
    || (mode === "parts" && (selectedFamily.length || selectedParts.length < 2))
    || (mode === "single" && (selectedFamily.length || selectedParts.length !== 1))) {
    throw new Error("作業形態に合う作業者を選択してください。");
  }
  if (shiftEligible !== null && selectedParts.some(name => !shiftEligible.has(name))) {
    throw new Error("この日のシフトにいないパート従業員が含まれています。作業者を選び直してください。");
  }
}
function notice(message, error = false) {
  el("status").textContent = message;
  el("status").classList.toggle("error", error);
  el("plan-login").hidden = hasSession();
}
function renderWorkers() {
  renderScope();
  const mode = el("plan-kind").value;
  el("plan-workers").textContent = [...selectedFamily, ...selectedParts].join(" / ") || "未選択";
  el("participant-kind").textContent = {
    family: "家族従業員を選択してください。",
    mixed: "家族従業員とパート従業員を選択してください（LINE報告なし）。",
    parts: "パート従業員を2人以上選択し、連絡係を指定してください。",
    single: "パート従業員を1人選択してください（本人が報告）。",
  }[mode] || "作業形態を選択してください。";
  if (mode === "parts" && selectedParts.length === 1) el("participant-kind").textContent = "③パート複数ですが、1人しか選択されていません。2人以上選択してください。";
  el("participant-kind").classList.toggle("warning", mode === "parts" && selectedParts.length === 1);
  el("reporter-group").hidden = mode !== "parts";
  const reporter = el("plan-reporter").value;
  el("plan-reporter").innerHTML = '<option value="">連絡係を選択</option>' + selectedParts.map(name =>
    `<option value="${escape(name)}">${escape(name)}</option>`).join("");
  el("plan-reporter").value = selectedParts.includes(reporter) ? reporter : selectedParts[0] || "";
  el("plan-reporter").disabled = mode !== "parts" || selectedParts.length < 2;
  renderUnplannedParts();
}
function renderBlocks() {
  el("plan-blocks").innerHTML = blocks.map((block, index) => {
    const family = blockFamily(block);
    const mixed = selectedParts.length > 0 && family.length > 0;
    let times = "";
    let bounds = "";
    if (selectedParts.length) {
      try {
        if (!shiftReady) {
          const saved = blocks[index].participation;
          const description = saved ? selectedParts.map(name => `${name}：${(saved[name] || []).map(range =>
            `${range.start}〜${range.end}`).join("・")}`).join("／") : "";
          throw new Error(`${description ? `保存済み参加時間 ${description}。` : ""}シフトを読み込むと勤務時間・他の予定から時間候補を表示します。`);
        }
        const availability = blockAvailability(index);
        const starts = availability.candidates.map(range => range.start).sort();
        const ends = availability.candidates.map(range => range.end).sort();
        bounds = !mixed && starts.length ? ` min="${starts[0]}" max="${ends.at(-1)}"` : "";
        times = `<div class="work-time-candidates"><p>${mixed ? "パートの参加時間候補（作業全体の時間は変更できます）" : "作業時間の候補（勤務・昼休憩・別予定を考慮）"}</p>${availability.candidates.map((range, target) =>
          `<button type="button" class="secondary-btn plan-toggle" data-time-block="${index}" data-time-choice="${target}" aria-pressed="${block.start === range.start && block.end === range.end}">${range.start}〜${range.end}${range.through ? "（通し・昼休憩あり）" : ""}</button>`).join("")
          || "<p>選択した全員が参加できる時間候補がありません。</p>"}
          ${availability.unknown.length ? `<p class="plan-note">${escape(availability.unknown.join("・"))}の時間未指定の予定は差し引いていません。</p>` : ""}
          <p class="plan-note">${mixed
            ? "開始・終了は家族を含む作業全体の時間です。パートは本人の勤務時間内だけ参加し、昼休憩を除きます。"
            : "通しは昼休憩を挟んで同じ作業を行います。作業時間は候補内で短く調整でき、各人の参加時間から昼休憩を除きます。"}</p>`;
        if (validTimeRange(block)) {
          try {
            const participation = participationForWork(block, selectedParts, availability, mixed);
            if (mixed) times += `<p>家族：${escape(family.join("・"))} ${escape(block.start)}〜${escape(block.end)}（作業全体）</p>`;
            times += Object.entries(participation).map(([name, ranges]) =>
              `<p>${escape(name)}：${ranges.map(range => `${range.start}〜${range.end}`).join("・")}</p>`).join("");
          } catch (error) { times += `<p class="plan-note warning">${escape(error.message)}</p>`; }
        }
        times += "</div>";
      } catch (error) {
        times = `<p class="plan-note warning">${escape(error.message)}</p>`;
      }
    }
    return `<fieldset class="plan-block">
    <legend>作業 ${index + 1}</legend>
    <button type="button" class="secondary-btn" data-task="${index}">作業内容を選択</button>
    <p>${escape(block.task || "未選択")}</p>
    <label>作業内容（自由入力・修正）<input class="form-input" data-block="${index}" data-key="task" value="${escape(block.task)}" maxlength="200"></label>
    <details${selectedParts.length || block.start || block.fields.length || block.shed ? " open" : ""}><summary>時間・圃場${mixed ? "（作業全体と各人の参加時間）" : selectedParts.length ? "（パートの時間は勤務内）" : "（任意）"}</summary>
      ${times}
      <label>${mixed ? "作業全体の開始" : "開始"} <input type="time" class="form-input" data-block="${index}" data-key="start" value="${escape(block.start)}"${bounds}></label>
      <label>${mixed ? "作業全体の終了" : "終了"} <input type="time" class="form-input" data-block="${index}" data-key="end" value="${escape(block.end)}"${bounds}></label>
      <div class="plan-actions"><button type="button" class="secondary-btn plan-toggle" data-shed="${index}" aria-pressed="${Boolean(block.shed)}">作業場集合</button></div>
      <button type="button" class="secondary-btn" data-field="${index}">圃場を追加（複数可）</button>
      <div>${block.fields.map((field, target) => `<button type="button" class="secondary-btn" data-remove-field="${index}" data-field-index="${target}">${escape(field)} ×</button>`).join("")}</div>
    </details>
    ${selectedFamily.length && selectedParts.length && block.companions
      && (block.companions.length !== selectedFamily.length || selectedFamily.some(name => !block.companions.includes(name)))
      ? `<details><summary>既存の作業別参加者設定</summary><p>${escape(block.companions.join("・") || "なし")}</p><button type="button" class="secondary-btn" data-companions="${index}">この作業の家族を選択</button></details>` : ""}
    ${blocks.length > 1 ? `<button type="button" class="secondary-btn" data-remove-block="${index}">この作業を削除</button>` : ""}
  </fieldset>`;
  }).join("");
}
function clearForm() {
  el("plan-form").reset();
  setPlanOff(false);
  selectedFamily = [];
  selectedParts = [];
  blocks = [newBlock()];
  editingId = null;
  source = "direct";
  savedAttendance = {};
  el("plan-kind").value = "";
  renderScope();
  renderWorkers();
  renderBlocks();
  el("editing-label").textContent = "新しい予定";
  cleanSnapshot = snapshot();
}
function setPlanOff(off) {
  el("plan-off").checked = off;
  el("plan-off-toggle").setAttribute("aria-pressed", String(off));
}
function hasSentCommunication(id, plan) {
  return plan.last_communication?.status === "sent"
    || record.data.communications.some(item => item.plan_id === id && item.status === "sent");
}
function renderSaved() {
  renderUnplannedParts();
  const plans = Object.entries(record.data.plans);
  el("saved-plans").innerHTML = plans.length ? plans.map(([id, plan]) => {
    const participants = [...new Set([...plan.names, ...plan.blocks.flatMap(block => block.companions || [])])];
    const sent = hasSentCommunication(id, plan);
    const hasRecipients = (plan.recipients || (plan.source === "message" ? plan.names : [])).length > 0;
    return `<article class="saved-plan"><h3>${escape(participants.join("・"))}</h3>
      ${hasRecipients || plan.last_communication ? `<p class="plan-note">${plan.last_communication ? `${sent ? "送信済み" : "連絡用にコピー済み"}${plan.communication_changed ? "・連絡後に変更あり" : ""}` : "連絡前"}</p>` : ""}
      ${plan.off ? `<p>中止${plan.off_reason ? `：${escape(plan.off_reason)}` : ""}</p>` : ""}
      ${plan.blocks.map(block => `<p>${block.start && block.end ? `${escape(block.start)}〜${escape(block.end)}　` : ""}${escape(block.task)}${block.fields?.length || block.field ? `｜${escape((block.fields || [block.field]).join("・"))}` : ""}</p>`).join("")}
      ${plan.memo ? `<p>${escape(plan.memo)}</p>` : ""}
      <div class="plan-actions"><button type="button" class="secondary-btn" data-edit="${escape(id)}">編集</button>
        <button type="button" class="secondary-btn" data-off="${escape(id)}">${plan.off ? "中止を解除" : "中止にする"}</button>
        <button type="button" class="secondary-btn" data-delete="${escape(id)}"${sent ? " disabled" : ""}>削除</button>
        ${hasRecipients ? `<a class="secondary-btn" href="/admin/message/index.html?date=${loadedDate}">連絡文を開く</a>` : ""}</div>
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
  if (date !== loadedDate) { shiftEligible = null; shiftGroups = []; shiftReady = false; noonBreak = null; }
  record = null;
  loadedDate = date;
  clearForm();
  el("plan-inputs").disabled = true;
  el("saved-plans").replaceChildren();
  el("saved-plans").inert = true;
  el("continue-team").disabled = true;
  el("communication-history").replaceChildren();
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
    el("continue-team").disabled = false;
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
    el("continue-team").disabled = true;
    renderUnplannedParts();
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
  savedAttendance = structuredClone(plan.attendance || {});
  const partNames = new Set(workerMaster.filter(worker => worker.role === "worker").map(worker => worker.display));
  const all = [...new Set([...plan.names, ...plan.blocks.flatMap(block => block.companions || [])])];
  selectedFamily = all.filter(name => !partNames.has(name));
  selectedParts = all.filter(name => partNames.has(name));
  inputScope = selectedParts.length ? "parts" : "family";
  renderScope();
  el("plan-kind").value = inferKind();
  blocks = plan.blocks.map(block => ({ ...structuredClone(block), fields: block.fields ? [...block.fields] : block.field ? [block.field] : [] }));
  renderWorkers();
  renderBlocks();
  el("plan-reporter").value = plan.reporter || selectedParts[0] || "";
  el("plan-memo").value = plan.memo || "";
  setPlanOff(plan.off);
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
  if (!record) { notice("先にこの日の予定を再読み込みしてください。", true); return; }
  const current = ++shiftSequence;
  const date = el("plan-date").value;
  shiftEligible = new Set();
  shiftReady = false;
  shiftGroups = [];
  renderWorkers();
  el("shift-state").textContent = "シフトを読み込み中…";
  try {
    const [plan, edits, settings] = await Promise.all([shiftApi("/shift/plan", { month: date.slice(0, 7) }),
      shiftApi("/shift/edits", { month: date.slice(0, 7) }), shiftApi("/shift/config")]);
    if (current !== shiftSequence || date !== el("plan-date").value) return;
    const scenario = plan.scenarios[defaultScenarioIndex(plan)];
    let items = applyAdjustments(plan, scenario, edits.overrides || {}, edits.base || null);
    if (edits.autofit) items = fitRemaining(plan, items, scenario.budget_max, edits.base || null).items;
    const groups = new Map();
    for (const item of items.filter(item => item.date === date && !["hold", "skip"].includes(item.status) && item.proposed_hours > 0)) {
      const start = toInputTime(item.start || ""), end = toInputTime(item.proposed_end || "");
      const key = `${start}|${end}`;
      if (!groups.has(key)) groups.set(key, { names: [], start, end });
      const name = resolveShiftWorker(item.person, settings.staff || plan.staff || [], activeParts());
      if (!groups.get(key).names.includes(name)) groups.get(key).names.push(name);
    }
    shiftGroups = [...groups.values()];
    const configuredBreak = plan.targets?.break_minutes?.spanning_noon ?? settings.break_minutes?.spanning_noon;
    if (!Number.isInteger(configuredBreak) || configuredBreak < 0 || configuredBreak > 180) {
      throw new Error("昼休憩の設定を確認できません。シフト設定を確認してください。");
    }
    noonBreak = configuredBreak;
    if (shiftGroups.some(group => !validTimeRange(group))) throw new Error("シフトの開始・終了時刻が不正です。");
    shiftEligible = new Set(shiftGroups.flatMap(group => group.names));
    shiftReady = true;
    initializeWorkTime();
    renderBlocks();
    renderWorkers();
    if (selectedParts.some(name => !shiftEligible.has(name))) {
      notice("選択中にこの日のシフトにいないパート従業員がいます。作業者を選び直してください。", true);
    } else notice("");
    el("shift-state").textContent = `${shiftEligible.size}人の出勤予定を読み込みました。作業形態を選び、作業者を選択してください。${plan.generated_at ? ` データ：${plan.generated_at}` : ""}`;
  } catch (error) {
    if (current !== shiftSequence) return;
    console.error("[daily-plan] shift load failed", error);
    renderWorkers();
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
  el("select-workers").onclick = async () => {
    const mode = el("plan-kind").value;
    const selectedDate = loadedDate, current = sequence;
    if (!mode) { notice("作業形態を選択してください。", true); return; }
    if (mode !== "family" && shiftEligible === null) await loadShift();
    if (current !== sequence || selectedDate !== loadedDate || mode !== el("plan-kind").value) return;
    if (!record || (mode !== "family" && (!shiftEligible || !shiftEligible.size))) {
      notice("この日のシフトにいるパート従業員を確認できません。シフトを読み込み直してください。", true); return;
    }
    const family = ["family", "mixed"].includes(mode)
      ? workerMaster.filter(worker => ["admin", "family"].includes(worker.role)) : [];
    const parts = mode === "family" ? [] : selectableParts();
    const workers = [...family, ...parts];
    const descriptions = Object.fromEntries(workers.map(worker => {
      const isPart = worker.role === "worker";
      const assignments = workerAssignments(worker.display, record.data.plans);
      const detail = assignments.map(item => `${item.start && item.end ? `${item.start}〜${item.end}` : "時間未指定"} ${item.task}`).join("／");
      const hours = shiftGroups.filter(group => group.names.includes(worker.display))
        .map(group => group.start && group.end ? `${group.start}〜${group.end}` : "時間未指定").join("・");
      return [worker.display, (mode === "mixed" ? isPart ? "パート従業員　" : "家族従業員　" : "")
        + (isPart ? `出勤：${hours}\n${detail || "作業予定未登録"}` : "")];
    }));
    openWorkerSelectModal({ workers, descriptions, title: "作業者の選択", single: mode === "single",
      selected: [...selectedFamily, ...selectedParts].filter(name => workers.some(worker => worker.display === name)),
      onApply: names => {
        selectedFamily = names.filter(name => family.some(worker => worker.display === name));
        selectedParts = names.filter(name => parts.some(worker => worker.display === name));
        blocks.forEach(block => { if (block.companions) block.companions = block.companions.filter(name => selectedFamily.includes(name)); });
        renderWorkers(); initializeWorkTime(); renderBlocks();
      },
    });
  };
  el("plan-scope").onchange = () => {
    inputScope = el("plan-scope").value;
    selectedFamily = []; selectedParts = [];
    blocks.forEach(block => { delete block.companions; });
    el("plan-kind").value = "";
    renderScope(); renderWorkers(); renderBlocks();
  };
  el("plan-kind").onchange = () => {
    const mode = el("plan-kind").value;
    if (!["family", "mixed"].includes(mode)) {
      selectedFamily = [];
      blocks.forEach(block => { delete block.companions; });
    }
    if (mode === "family" || !mode || (mode === "single" && selectedParts.length > 1)) selectedParts = [];
    renderWorkers(); renderBlocks();
  };
  el("add-block").onclick = () => { blocks.push(newBlock()); initializeWorkTime(); renderBlocks(); };
  el("plan-blocks").oninput = event => {
    const index = Number(event.target.dataset.block);
    if (!blocks[index] || !event.target.dataset.key) return;
    blocks[index][event.target.dataset.key] = event.target.type === "checkbox" ? event.target.checked : event.target.value;
  };
  el("plan-blocks").onchange = event => {
    if (["start", "end"].includes(event.target.dataset.key)) renderBlocks();
  };
  el("plan-blocks").onclick = event => {
    const shed = event.target.closest("[data-shed]");
    if (shed) {
      const block = blocks[Number(shed.dataset.shed)];
      block.shed = !block.shed;
      shed.setAttribute("aria-pressed", String(block.shed));
      return;
    }
    const time = event.target.closest("[data-time-block]");
    if (time) {
      const index = Number(time.dataset.timeBlock);
      try {
        const range = blockAvailability(index).candidates[Number(time.dataset.timeChoice)];
        if (!range) throw new Error("時間候補が変更されました。作業者・予定を確認してください。");
        Object.assign(blocks[index], range); initializeWorkTime(); renderBlocks();
      } catch (error) { console.error("[daily-plan] time selection failed", error); notice(error.message, true); }
      return;
    }
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
  el("plan-off-toggle").onclick = () => setPlanOff(!el("plan-off").checked);
  el("continue-team").onclick = () => {
    if (!record || !canDiscard()) return;
    clearForm();
    el("plan-form").scrollIntoView({ block: "start" });
    el("plan-kind").focus();
    notice("次の作業予定を入力してください。同じ人を別の作業にも選択できます。");
  };
  el("reload").onclick = () => { if (canDiscard()) return loadDay(); };
  el("plan-login").onclick = () => login(`/schedule/daily-plan/index.html?date=${el("plan-date").value}`);
  el("plan-date").onchange = () => {
    if (!el("plan-date").value || !canDiscard()) { el("plan-date").value = loadedDate; return; }
    return loadDay();
  };
  el("load-shift").onclick = loadShift;
  el("refresh-shift").onclick = refreshShift;
  el("plan-form").onsubmit = async event => {
    event.preventDefault();
    try {
      validateParticipants();
      if (selectedParts.length && !el("plan-off").checked) {
        if (record.time_support !== true) throw new Error("勤務時間保存に対応したAPIへ更新が必要です。");
        const current = sequence, date = loadedDate;
        if (!shiftReady) {
          el("page-area").inert = true;
          try { await loadShift(); } finally { el("page-area").inert = false; }
        }
        if (current !== sequence || date !== loadedDate) throw new Error("日付が変更されました。入力を確認してください。");
        if (!shiftReady) throw new Error("パートの勤務時間を確認できません。シフトを読み込み直してください。");
        blocks.forEach((block, index) => {
          block.participation = participationForWork(block, selectedParts, blockAvailability(index), blockFamily(block).length > 0);
        });
      }
      const plan = createUnifiedPlan(selectedFamily, selectedParts, blocks, el("plan-memo").value,
        el("plan-reporter").value, el("plan-off").checked, el("plan-off-reason").value, source,
        selectedParts.length && (shiftReady || Object.keys(savedAttendance).length) ? attendanceForSelection() : null);
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
