const DEBUG = true;

function debugLog(...args) {
  if (DEBUG) console.log("[nursery-pesticide]", ...args);
}

import { openpesticideModal } from "/common/filter/filter-pesticide.js?v=1";
import { setFilterData, getFilterData, filterState } from "/common/filter/filter-core.js?v=1";
import { initActiveFilterUI } from "/common/filter/filter-active.js?v=1";
import { confirmSaveBeforeSubmit } from "/common/save-modal.js?v=1";
import { saveLog } from "/common/save/index.js?v=1";
import { getSelectedWorkers } from "/common/ui.js?v=1";

import {
  setpesticideDict,
  renderNurseryPesticideInputs,
  getNurseryPesticideInputData
} from "./pesticide-input.js?v=20260724-1";

const CROSS_FERTILIZER_CATEGORIES_FOR_PESTICIDE = ["液肥", "葉面散布剤", "BS資材"];

const NURSERY_TARGET_GROUPS = [
  {
    id: "east",
    label: "東棟",
    lanes: [
      { id: "east-1", label: "東③" },
      { id: "east-2", label: "東②" },
      { id: "east-3", label: "東①" }
    ]
  },
  {
    id: "west",
    label: "西棟",
    lanes: [
      { id: "west-1", label: "西④" },
      { id: "west-2", label: "西③" },
      { id: "west-3", label: "西②" },
      { id: "west-4", label: "西①" }
    ]
  },
  {
    id: "outside",
    label: "外",
    lanes: [
      { id: "outside-1", label: "外①" },
      { id: "outside-2", label: "外②" },
      { id: "outside-3", label: "外③" },
      { id: "outside-4", label: "外④" },
      { id: "outside-5", label: "外⑤" }
    ]
  }
];

const selectedTargetIds = new Set();

export async function initNurseryPesticidePage() {
  await initPesticideFilterData();
  initActiveFilterUI();

  filterState.pesticides = [];

  bindControls();
  renderTargetArea();
  renderNurseryPesticideInputs();
  updateSummary();
}

function bindControls() {
  const btnPesticide = document.getElementById("open-pesticide-modal");
  if (btnPesticide) {
    btnPesticide.onclick = () => openpesticideModal({ mode: "filter" });
  }

  const btnSave = document.getElementById("save-btn");
  if (btnSave) {
    btnSave.onclick = () => saveNurseryPesticideLog(btnSave);
  }

  const targetArea = document.getElementById("nursery-target-area");
  if (targetArea) {
    targetArea.addEventListener("click", event => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const laneBtn = target.closest("[data-target-id]");
      if (laneBtn instanceof HTMLElement) {
        toggleTarget(laneBtn.dataset.targetId || "");
        return;
      }

      const zoneAllBtn = target.closest("[data-zone-all]");
      if (zoneAllBtn instanceof HTMLElement) {
        setZoneTargets(zoneAllBtn.dataset.zoneAll || "", true);
        return;
      }

      const zoneClearBtn = target.closest("[data-zone-clear]");
      if (zoneClearBtn instanceof HTMLElement) {
        setZoneTargets(zoneClearBtn.dataset.zoneClear || "", false);
      }
    });
  }

  window.addEventListener("filter:apply", () => {
    renderNurseryPesticideInputs();
  });

  window.addEventListener("filter:reset", () => {
    filterState.pesticides = [];
    renderNurseryPesticideInputs();
  });
}

async function initPesticideFilterData() {
  const [list, detail, fertilizerList, fertilizerDetail] = await Promise.all([
    fetch("/data/pesticide/pesticide-index.json?v=" + Date.now()).then(r => r.json()),
    fetch("/data/pesticide/pesticide-detail.json?v=" + Date.now())
      .then(r => (r.ok ? r.json() : {}))
      .catch(() => ({})),
    fetch("/data/fertilizer/fertilizer-index.json?v=" + Date.now())
      .then(r => (r.ok ? r.json() : []))
      .catch(() => ([])),
    fetch("/data/fertilizer/fertilizer-detail.json?v=" + Date.now())
      .then(r => (r.ok ? r.json() : {}))
      .catch(() => ({}))
  ]);

  const dict = {};
  list.forEach(f => {
    const byId = detail?.[f.id] || {};
    dict[f.name] = {
      ...byId,
      ...f,
      id: f.id,
      name: f.name,
      category: f.category,
      unit: f.unit,
      materialType: "pesticide",
      sourceMaster: "pesticide-index"
    };
  });

  const crossTargets = Array.isArray(fertilizerList)
    ? fertilizerList.filter(v => CROSS_FERTILIZER_CATEGORIES_FOR_PESTICIDE.includes(String(v?.category || "").trim()))
    : [];

  crossTargets.forEach(f => {
    const byId = fertilizerDetail?.[f.id] || {};
    const unit = String(byId?.packaging?.unit || byId?.unit || "ml").trim() || "ml";
    dict[f.name] = {
      ...byId,
      ...f,
      id: f.id,
      name: f.name,
      category: f.category,
      unit,
      materialType: "fertilizer",
      sourceMaster: "fertilizer-index"
    };
  });

  setpesticideDict(dict);

  const parents = [];
  const children = {};

  list.forEach(f => {
    if (!children[f.category]) {
      children[f.category] = [];
      parents.push(f.category);
    }
    children[f.category].push(f.name);
  });

  crossTargets.forEach(f => {
    if (!children[f.category]) {
      children[f.category] = [];
      parents.push(f.category);
    }
    if (!children[f.category].includes(f.name)) {
      children[f.category].push(f.name);
    }
  });

  const current = getFilterData();
  setFilterData({
    ...current,
    fields: { parents: [], children: {} },
    varieties: { parents: [], children: {} },
    pesticides: { parents, children }
  });
}

function renderTargetArea() {
  const area = document.getElementById("nursery-target-area");
  if (!area) return;

  area.innerHTML = NURSERY_TARGET_GROUPS.map(zone => `
    <section class="target-zone">
      <div class="target-zone__head">
        <div class="target-zone__title">${escapeHtml(zone.label)}</div>
        <div class="target-zone__actions">
          <button class="secondary-btn" type="button" data-zone-all="${escapeHtml(zone.id)}">全選択</button>
          <button class="secondary-btn" type="button" data-zone-clear="${escapeHtml(zone.id)}">解除</button>
        </div>
      </div>
      <div class="target-zone__lanes">
        ${zone.lanes.map(lane => `
          <button
            type="button"
            class="target-lane-btn ${selectedTargetIds.has(lane.id) ? "is-active" : ""}"
            data-target-id="${escapeHtml(lane.id)}"
            data-target-zone="${escapeHtml(zone.id)}"
          >${escapeHtml(lane.label)}</button>
        `).join("")}
      </div>
    </section>
  `).join("");
}

function updateSummary() {
  const el = document.getElementById("nursery-target-summary");
  if (!el) return;

  const selected = getSelectedTargets();
  if (selected.length === 0) {
    el.textContent = "未選択";
    return;
  }

  const labels = selected.map(v => v.label);
  el.textContent = labels.length <= 4
    ? `選択中: ${labels.join("、")}`
    : `選択中: ${labels.slice(0, 4).join("、")} ほか${labels.length - 4}件`;
}

function toggleTarget(targetId) {
  if (!targetId) return;

  if (selectedTargetIds.has(targetId)) {
    selectedTargetIds.delete(targetId);
  } else {
    selectedTargetIds.add(targetId);
  }

  renderTargetArea();
  updateSummary();
}

function setZoneTargets(zoneId, enabled) {
  const zone = NURSERY_TARGET_GROUPS.find(v => v.id === zoneId);
  if (!zone) return;

  zone.lanes.forEach(lane => {
    if (enabled) selectedTargetIds.add(lane.id);
    else selectedTargetIds.delete(lane.id);
  });

  renderTargetArea();
  updateSummary();
}

function getSelectedTargets() {
  const ordered = [];
  NURSERY_TARGET_GROUPS.forEach(zone => {
    zone.lanes.forEach(lane => {
      if (selectedTargetIds.has(lane.id)) {
        ordered.push({
          id: lane.id,
          label: lane.label,
          zone: zone.id,
          zoneLabel: zone.label
        });
      }
    });
  });
  return ordered;
}

async function saveNurseryPesticideLog(btn) {
  const date = document.getElementById("date")?.value || "";
  const targets = getSelectedTargets();
  const pesticides = getNurseryPesticideInputData();
  const notes = document.getElementById("notes")?.value.trim() || "";
  const machine = window.__nursery_pesticide_machine || "machine1";
  const workers = getSelectedWorkers("workers_box", "temp_workers");

  if (!date) {
    alert("日付を入力してください");
    return;
  }
  if (targets.length === 0) {
    alert("対象を1つ以上選択してください");
    return;
  }
  if (!pesticides.length) {
    alert("農薬の希釈倍率・散布液量（L）を入力してください");
    return;
  }
  if (!String(workers || "").trim()) {
    alert("作業者は必須です");
    return;
  }

  const targetLabel = targets.length <= 4
    ? targets.map(v => v.label).join("、")
    : `${targets.slice(0, 4).map(v => v.label).join("、")} ほか${targets.length - 4}件`;

  const confirmed = await confirmSaveBeforeSubmit({
    lines: [
      `日付: ${date}`,
      `対象: ${targetLabel}`,
      `作業者: ${workers}`,
      `農薬件数: ${pesticides.length}件`
    ]
  });
  if (!confirmed) return;

  if (btn) {
    btn.disabled = true;
    btn.textContent = "保存中…";
  }

  try {
    await saveLog({
      type: "nursery-pesticide",
      csv: buildCsvLine({ date, targets, pesticides, machine, workers, notes }) + "\n",
      summary: {
        date,
        sourceKey: "nursery-pesticide",
        count: 1
      }
    });

    const notesEl = document.getElementById("notes");
    if (notesEl) notesEl.value = "";
  } catch (e) {
    console.error(e);
    alert("保存に失敗しました");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "保存";
    }
  }
}

function buildCsvLine({ date, targets, pesticides, machine, workers, notes }) {
  const values = [
    date,
    String(targets.length),
    JSON.stringify(targets),
    JSON.stringify(pesticides),
    machine,
    workers,
    notes
  ];

  return values.map(csvEscape).join(",");
}

function csvEscape(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}