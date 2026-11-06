import { openModal, closeModal, bindModalCloseEvents } from "/common/filter/filter-core.js?v=1";

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

export async function loadPlanWorkers() {
  const response = await fetch("/data/workers.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`担当者を取得できません（${response.status}）。`);
  const workers = await response.json();
  if (!Array.isArray(workers)) throw new Error("担当者データの形式が不正です。");
  return workers;
}

export async function loadFamilyWorkers() {
  const workers = await loadPlanWorkers();
  return [...new Set(workers.filter(worker => ["admin", "family"].includes(worker.role))
    .map(worker => String(worker.display || "").trim()).filter(Boolean))];
}

export const PLAN_TASK_GROUPS = [
  ["播種・育苗", ["播種", "育苗"]],
  ["定植", ["定植"]],
  ["収穫・出荷", ["収穫", "出荷"]],
  ["栽培管理", ["防除", "施肥", "潅水", "中耕"]],
  ["圃場管理", ["耕起", "畝立て", "除草剤散布", "草刈り", "草とり", "圃場整備"]],
  ["その他", ["片付け", "その他（自由入力）"]],
];

export function openPlanTaskModal({ selected, onSelect, onClose = null }) {
  if (selected === "出荷調整") selected = "出荷";
  openModal(`<div class="modal-bg" id="modal-bg"><div class="modal plan-task-modal" role="dialog" aria-modal="true" aria-labelledby="plan-task-title">
    <button type="button" class="modal-close" id="modal-close" aria-label="閉じる">×</button>
    <h3 id="plan-task-title">作業内容の選択</h3>
    <div class="plan-task-groups">${PLAN_TASK_GROUPS.map(([group, tasks]) => `
      <details open><summary>${group}</summary>
        <div class="plan-task-choices">${tasks.map(task => `<button type="button" class="plan-task-card" data-plan-task="${task === "その他（自由入力）" ? "__custom__" : task}" aria-pressed="${task === selected || (selected === "__custom__" && task === "その他（自由入力）")}">${task}</button>`).join("")}</div>
      </details>`).join("")}</div>
    <div class="modal-footer"><button type="button" class="secondary-btn" id="clear-plan-task">選択を解除</button><button type="button" class="secondary-btn" id="close-plan-task">閉じる</button></div>
  </div></div>`);
  const close = () => { closeModal(); onClose?.(); };
  bindModalCloseEvents({ onClose });
  document.getElementById("close-plan-task").onclick = close;
  document.getElementById("clear-plan-task").onclick = () => { onSelect(""); close(); };
  document.querySelectorAll("[data-plan-task]").forEach(button => {
    button.onclick = () => {
      onSelect(button.dataset.planTask);
      close();
    };
  });
}
