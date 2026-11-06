import { validTimeRange, intersectTimeRanges, mergeTimeRanges, workingTimeRanges } from "/common/work-plan-time.js?v=20261104-mixed-time-1";
import { relatedPlanLogs, fetchWorkPlanRecord } from "./planned-work.js?v=20261106-time-1";
import { config } from "/photos/config.js";
import { ensureToken } from "/photos/auth.js?v=20261029-2";
import { applyAdjustments, defaultScenarioIndex, fitRemaining, toInputTime } from "/admin/shift/shift-logic.js?v=20261101-6";
import { resolveShiftWorker } from "/common/work-plan-form.js?v=20261106-diary-time-1";

export const diaryWorkers = value => [...new Set((Array.isArray(value) ? value : [value])
  .flatMap(item => String(item || "").split(/[\/／、,，\n]/)).map(name => name.trim()).filter(Boolean))];
const escape = value => String(value ?? "").replace(/[&<>"']/g,
  char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
export const hasParticipation = work => Object.hasOwn(work, "participation");

export function validateDiaryTimes(work) {
  if ((work.start || work.end) && !validTimeRange(work)) throw new Error("作業全体の開始・終了を両方入力し、終了を開始より後にしてください。");
  if (!hasParticipation(work)) return;
  const map = work.participation;
  if (!map || typeof map !== "object" || Array.isArray(map)) throw new Error("人別の参加時間の形式が不正です。");
  const names = diaryWorkers(work.workers);
  for (const [name, ranges] of Object.entries(map)) {
    if (!names.includes(name) || !Array.isArray(ranges)) throw new Error("従事者と参加時間が一致しません。");
    let previous = "";
    for (const range of [...ranges].sort((a, b) => String(a?.start).localeCompare(String(b?.start)))) {
      if (!validTimeRange(range)) throw new Error(`${name}の開始・終了を両方入力し、終了を開始より後にしてください。`);
      if (!validTimeRange(work) || range.start < work.start || range.end > work.end) throw new Error(`${name}の参加時間が作業全体の時間外です。`);
      if (previous > range.start) throw new Error(`${name}の参加時間帯が重複しています。`);
      previous = range.end;
    }
  }
}

export function diaryTimeOverlaps(works) {
  const warnings = new Set();
  works.forEach((work, index) => {
    if (!hasParticipation(work)) return;
    for (const [name, ranges] of Object.entries(work.participation)) {
      works.slice(index + 1).forEach(other => {
        if (hasParticipation(other) && ranges.some(a => (other.participation[name] || [])
          .some(b => a.start < b.end && b.start < a.end))) {
          warnings.add(`${name}：「${work.type}」と「${other.type}」の参加時間が重複しています。`);
        }
      });
    }
  });
  return [...warnings];
}

export function mergeDiaryParticipation(groups) {
  if (!groups.some(hasParticipation)) return {};
  const names = diaryWorkers(groups.flatMap(group => diaryWorkers(group.workers)));
  return { participation: Object.fromEntries(names.map(name => [name,
    mergeTimeRanges(groups.flatMap(group => group.participation?.[name] || []))])) };
}

export function diaryPlanCandidates(work, logs, plans) {
  const names = diaryWorkers(work.workers);
  return Object.entries(plans).flatMap(([id, plan]) => plan.off ? [] : plan.blocks.flatMap((block, index) => {
    if (!validTimeRange(block)) return [];
    const participation = {};
    for (const name of names) {
      if (!plan.names.includes(name) && !(block.companions || []).includes(name)) continue;
      if (!relatedPlanLogs(name, block, logs).length) continue;
      const ranges = block.participation && Object.hasOwn(block.participation, name)
        ? block.participation[name] : [{ start: block.start, end: block.end }];
      if (ranges.length) participation[name] = ranges.map(range => ({ ...range }));
    }
    if (!Object.keys(participation).length) return [];
    return [{ id: `${id}:${index}`, task: block.task, start: block.start, end: block.end,
      fields: block.fields || diaryWorkers(block.field), participation }];
  }));
}

export async function loadDiaryPlanCandidates() {
  const date = document.getElementById("diaryDate").value;
  const result = await fetchWorkPlanRecord(date);
  if (result.data.plans === undefined) throw new Error("日別予定APIの更新が必要です。");
  return result.data.plans;
}

export async function loadDiaryShiftTimes(date) {
  const token = await ensureToken();
  if (!token) throw new Error("シフトを見るにはログインが必要です。");
  const get = async (path, query = {}) => {
    const response = await fetch(`${config.api}${path}?${new URLSearchParams(query)}`, {
      cache: "no-store", headers: { Authorization: `Bearer ${token}` },
    });
    if (response.status === 404 && path === "/shift/edits") return {};
    if (!response.ok) throw new Error(`シフトを取得できません（${response.status}）。`);
    return response.json();
  };
  const [plan, edits, settings, response] = await Promise.all([
    get("/shift/plan", { month: date.slice(0, 7) }), get("/shift/edits", { month: date.slice(0, 7) }),
    get("/shift/config"), fetch("/data/workers.json", { cache: "no-store" }),
  ]);
  if (!response.ok) throw new Error(`従事者を取得できません（${response.status}）。`);
  const workers = await response.json();
  if (!Array.isArray(workers)) throw new Error("従事者データの形式が不正です。");
  const scenario = plan.scenarios[defaultScenarioIndex(plan)];
  let items = applyAdjustments(plan, scenario, edits.overrides || {}, edits.base || null);
  if (edits.autofit) items = fitRemaining(plan, items, scenario.budget_max, edits.base || null).items;
  const attendance = {};
  for (const item of items.filter(item => item.date === date && !["hold", "skip"].includes(item.status) && item.proposed_hours > 0)) {
    const name = resolveShiftWorker(item.person, settings.staff || plan.staff || [], workers.filter(worker => worker.role === "worker"));
    const range = { start: toInputTime(item.start || ""), end: toInputTime(item.proposed_end || "") };
    if (!validTimeRange(range)) throw new Error(`${name}のシフト時刻が不正です。`);
    (attendance[name] ||= []).push(range);
  }
  const noonBreak = plan.targets?.break_minutes?.spanning_noon ?? settings.break_minutes?.spanning_noon;
  return Object.fromEntries(Object.entries(attendance).map(([name, ranges]) => [name, workingTimeRanges(ranges, noonBreak)]));
}

function timeRow(name, range = { start: "", end: "" }) {
  const row = document.createElement("div");
  row.className = "diary-person-range";
  row.innerHTML = `<input type="time" aria-label="${escape(name)}の参加開始" value="${escape(range.start)}">
    <span>〜</span><input type="time" aria-label="${escape(name)}の参加終了" value="${escape(range.end)}">
    <button type="button" class="secondary-btn">解除</button>`;
  row.querySelector("button").onclick = () => row.remove();
  return row;
}

export function renderDiaryParticipation(card, work) {
  if (hasParticipation(work)) validateDiaryTimes(work);
  const area = document.createElement("section");
  area.className = "diary-participation";
  area.innerHTML = '<h4>各人の参加時間（実績）</h4><p class="memo-desc" data-help="各人の参加時間について">空欄は未記録です。途中参加・退出や休憩は時間帯を分けて記録してください。予定・シフトは候補で、保存後に実績として扱います。</p><div class="diary-time-candidates"></div>';
  for (const name of diaryWorkers(work.workers)) {
    const person = document.createElement("div");
    person.className = "diary-person";
    person.dataset.person = name;
    const label = document.createElement("strong");
    label.textContent = name;
    person.appendChild(label);
    const ranges = document.createElement("div");
    ranges.className = "diary-person-ranges";
    const saved = work.participation?.[name] || [];
    for (const range of saved.length ? saved : [{ start: "", end: "" }]) ranges.appendChild(timeRow(name, range));
    person.appendChild(ranges);
    const add = document.createElement("button");
    add.type = "button";
    add.className = "secondary-btn";
    add.textContent = "＋時間帯";
    add.onclick = () => ranges.appendChild(timeRow(name));
    person.appendChild(add);
    area.appendChild(person);
  }
  if (!hasParticipation(work) && (work.start || work.end)) {
    const warning = document.createElement("p");
    warning.className = "memo-desc";
    warning.textContent = "旧日誌の時間は作業全体として保持しています。全員が同じ時間に参加したとは扱いません。人別時間を確認してください。";
    area.appendChild(warning);
  }
  card.appendChild(area);
}

export function readDiaryParticipation(card) {
  return Object.fromEntries([...card.querySelectorAll(".diary-person")].map(person => [person.dataset.person,
    [...person.querySelectorAll(".diary-person-range")].map(row => {
      const inputs = row.querySelectorAll("input");
      return { start: inputs[0].value, end: inputs[1].value };
    }).filter(range => range.start || range.end)]));
}

function applyCandidate(card, participation, overall) {
  const inputs = card.querySelectorAll(".edit-time-row input");
  if (overall && !inputs[0].value && !inputs[1].value) {
    inputs[0].value = overall.start;
    inputs[1].value = overall.end;
  }
  for (const person of card.querySelectorAll(".diary-person")) {
    if (!Object.hasOwn(participation, person.dataset.person)) continue;
    const ranges = person.querySelector(".diary-person-ranges");
    ranges.replaceChildren(...participation[person.dataset.person].map(range => timeRow(person.dataset.person, range)));
  }
}

export function showDiaryTimeCandidates(card, work, candidates, shifts = null) {
  const area = card.querySelector(".diary-time-candidates");
  area.replaceChildren();
  for (const candidate of candidates) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary-btn diary-candidate";
    button.textContent = `予定を使う：${candidate.task} ${candidate.fields.join("・")} ${candidate.start}〜${candidate.end}／`
      + Object.entries(candidate.participation).map(([name, ranges]) => `${name} ${ranges.map(r => `${r.start}〜${r.end}`).join("・")}`).join("／");
    button.onclick = () => {
      if (!confirm("この予定の人別時間を入力欄に取り込みます。対象の人の入力を置き換えてよろしいですか？（保存はまだ行いません）")) return;
      applyCandidate(card, candidate.participation, candidate);
    };
    area.appendChild(button);
  }
  if (!candidates.length && shifts === null) {
    const note = document.createElement("p");
    note.className = "memo-desc";
    note.textContent = "一致する時間付き予定はありません。手入力、またはシフトを目安にしてください。";
    area.appendChild(note);
  }
  if (shifts !== null) for (const name of diaryWorkers(work.workers)) {
    if (!shifts[name]?.length) continue;
    const note = document.createElement("p");
    note.className = "memo-desc";
    note.textContent = `シフトの目安：${name} ${shifts[name].map(r => `${r.start}〜${r.end}`).join("・")}（昼休憩を除く）`;
    area.appendChild(note);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary-btn";
    button.textContent = `${name}：作業全体とシフトの重なる時間を使う`;
    button.onclick = () => {
      const inputs = card.querySelectorAll(".edit-time-row input");
      const overall = { start: inputs[0].value, end: inputs[1].value };
      if (!validTimeRange(overall)) { alert("先に作業全体の開始・終了を入力してください。"); return; }
      const ranges = intersectTimeRanges([overall], shifts[name]);
      if (!ranges.length) { alert("作業全体とシフトに重なる時間がありません。"); return; }
      if (confirm(`${name}の入力をシフト候補で置き換えます。別作業への参加や実際の休憩を確認して修正してください。`)) {
        applyCandidate(card, { [name]: ranges });
      }
    };
    area.appendChild(button);
  }
}
