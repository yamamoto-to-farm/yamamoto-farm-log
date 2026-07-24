const DEBUG = true;

function debugLog(...args) {
  if (DEBUG) console.log("[nursery-pesticide]", ...args);
}

function formatNum(v) {
  return Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 1 });
}

import { loadCSV, normalizeKeys } from "/common/csv.js?v=1";
import { loadJSON } from "/common/json.js?v=1";
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
      { id: "east-1", label: "東③", capacity: 366 },
      { id: "east-2", label: "東②", capacity: 610 },
      { id: "east-3", label: "東①", capacity: 366 }
    ]
  },
  {
    id: "west",
    label: "西棟",
    lanes: [
      { id: "west-1", label: "西④", capacity: 240 },
      { id: "west-2", label: "西③", capacity: 160 },
      { id: "west-3", label: "西②", capacity: 160 },
      { id: "west-4", label: "西①", capacity: 240 }
    ]
  },
  {
    id: "outside",
    label: "外",
    lanes: [
      { id: "outside-1", label: "外①", capacity: 162 },
      { id: "outside-2", label: "外②", capacity: 108 },
      { id: "outside-3", label: "外③", capacity: 75 },
      { id: "outside-4", label: "外④", capacity: 324 },
      { id: "outside-5", label: "外⑤", capacity: 300 }
    ]
  }
];

const selectedSeedRefs = new Set();

const targetState = {
  laneLotsByLane: new Map(),
  lotsBySeedRef: new Map()
};

export async function initNurseryPesticidePage() {
  await initPesticideFilterData();
  await initTargetData();

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

      const laneBtn = target.closest("[data-lane-id]");
      if (laneBtn instanceof HTMLElement) {
        toggleLaneSelection(String(laneBtn.dataset.laneId || "").trim());
        return;
      }

      const laneClearBtn = target.closest("[data-lane-clear]");
      if (laneClearBtn instanceof HTMLElement) {
        clearLaneSelection(String(laneClearBtn.dataset.laneClear || "").trim());
        return;
      }

      const zoneAllBtn = target.closest("[data-zone-all]");
      if (zoneAllBtn instanceof HTMLElement) {
        setZoneSelection(String(zoneAllBtn.dataset.zoneAll || "").trim(), true);
        return;
      }

      const zoneClearBtn = target.closest("[data-zone-clear]");
      if (zoneClearBtn instanceof HTMLElement) {
        setZoneSelection(String(zoneClearBtn.dataset.zoneClear || "").trim(), false);
        return;
      }

      const lotRemoveBtn = target.closest("[data-remove-seed-ref]");
      if (lotRemoveBtn instanceof HTMLElement) {
        const seedRef = String(lotRemoveBtn.dataset.removeSeedRef || "").trim();
        const laneId = String(lotRemoveBtn.dataset.removeLaneId || "").trim();
        removeSeedRef(seedRef, laneId);
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

async function initTargetData() {
  const [seedRowsRaw, plantingRowsRaw, discardPlantingRaw, discardSeedRaw, legacyNurseryRaw, layout] = await Promise.all([
    loadCSV("/logs/seed/all.csv").catch(() => []),
    loadCSV("/logs/planting/all.csv").catch(() => []),
    loadCSV("/logs/discard-planting/all.csv").catch(() => []),
    loadCSV("/logs/discard-seed/all.csv").catch(() => []),
    loadCSV("/logs/nursery/all.csv").catch(() => []),
    loadJSON("/logs/nursery/house-layout.json").catch(() => ({ blocks: [] }))
  ]);

  const seedRows = normalizeKeys(seedRowsRaw || []);
  const plantingRows = normalizeKeys(plantingRowsRaw || []);
  const discardPlantingRows = normalizeKeys(discardPlantingRaw || []);
  const discardSeedRows = normalizeKeys(discardSeedRaw || []);
  const legacyNurseryRows = normalizeKeys(legacyNurseryRaw || []);

  const lots = buildLots(seedRows, plantingRows, discardPlantingRows, discardSeedRows, legacyNurseryRows);
  targetState.lotsBySeedRef = new Map(lots.map(lot => [lot.seedRef, lot]));

  const laneLotsByLane = new Map();
  const blocks = Array.isArray(layout?.blocks) ? layout.blocks : [];

  blocks.forEach(block => {
    const laneId = String(block?.laneId || "").trim();
    const seedRef = String(block?.originSeedRef || block?.seedRef || "").trim();
    const trays = toNumber(block?.trays);
    if (!laneId || !seedRef || trays <= 0) return;

    const lane = findLane(laneId);
    const lot = targetState.lotsBySeedRef.get(seedRef);
    if (!lane || !lot) return;

    if (!laneLotsByLane.has(laneId)) laneLotsByLane.set(laneId, new Map());
    const laneMap = laneLotsByLane.get(laneId);

    if (!laneMap.has(seedRef)) {
      laneMap.set(seedRef, {
        seedRef,
        variety: lot.variety,
        seedDate: lot.seedDate,
        trays: 0,
        blockCount: 0,
        laneId,
        laneLabel: lane.label,
        zoneId: getZoneByLaneId(laneId),
        zoneLabel: getZoneLabelByLaneId(laneId)
      });
    }

    const entry = laneMap.get(seedRef);
    entry.trays += trays;
    entry.blockCount += 1;
  });

  targetState.laneLotsByLane = new Map(
    Array.from(laneLotsByLane.entries()).map(([laneId, map]) => {
      const list = Array.from(map.values()).sort((a, b) => {
        const aMs = parseDateMs(a.seedDate);
        const bMs = parseDateMs(b.seedDate);
        const cmp = bMs - aMs;
        if (cmp !== 0) return cmp;
        return a.seedRef.localeCompare(b.seedRef, "ja");
      });
      return [laneId, list];
    })
  );
}

function renderTargetArea() {
  const area = document.getElementById("nursery-target-area");
  if (!area) return;

  area.innerHTML = NURSERY_TARGET_GROUPS.map(zone => {
    const zoneStats = getZoneSelectionStats(zone);
    const laneHTML = zone.lanes.map(lane => renderLaneCard(zone, lane)).join("");
    return `
      <section class="target-zone">
        <div class="target-zone__head">
          <div>
            <div class="target-zone__title">${escapeHtml(zone.label)}</div>
            <div class="target-zone__summary">${escapeHtml(zoneStats.text)}</div>
          </div>
          <div class="target-zone__actions">
            <button class="secondary-btn" type="button" data-zone-all="${escapeHtml(zone.id)}">この棟を全選択</button>
            <button class="secondary-btn" type="button" data-zone-clear="${escapeHtml(zone.id)}">解除</button>
          </div>
        </div>
        <div class="target-zone__lanes">${laneHTML}</div>
      </section>
    `;
  }).join("");
}

function getZoneSelectionStats(zone) {
  let laneCount = 0;
  let selectedLaneCount = 0;
  let selectedLotCount = 0;
  let selectedTrayCount = 0;

  zone.lanes.forEach(lane => {
    const lots = targetState.laneLotsByLane.get(lane.id) || [];
    if (!lots.length) return;

    laneCount += 1;
    const selectedLots = lots.filter(lot => selectedSeedRefs.has(lot.seedRef));
    if (selectedLots.length > 0) selectedLaneCount += 1;
    selectedLotCount += selectedLots.length;
    selectedTrayCount += selectedLots.reduce((sum, lot) => sum + toNumber(lot.trays), 0);
  });

  return {
    laneCount,
    selectedLaneCount,
    selectedLotCount,
    selectedTrayCount,
    text: laneCount > 0
      ? `対象レーン ${selectedLaneCount}/${laneCount}・${formatNum(selectedLotCount)}ロット・${formatNum(selectedTrayCount)}枚`
      : "対象ロットなし"
  };
}

function renderLaneCard(zone, lane) {
  const lots = targetState.laneLotsByLane.get(lane.id) || [];
  const selectedLots = lots.filter(lot => selectedSeedRefs.has(lot.seedRef));
  const totalCount = lots.length;
  const selectedCount = selectedLots.length;
  const selectedTrays = selectedLots.reduce((sum, lot) => sum + toNumber(lot.trays), 0);
  const capacity = toNumber(lane.capacity);
  const overBy = capacity > 0 ? Math.max(0, selectedTrays - capacity) : 0;
  const allSelected = totalCount > 0 && selectedCount === totalCount;
  const partial = selectedCount > 0 && selectedCount < totalCount;
  const expanded = selectedCount > 0;

  return `
    <section class="target-lane ${allSelected ? "is-active" : partial ? "is-partial" : ""} ${overBy > 0 ? "is-warning" : ""}">
      <button class="target-lane__head" type="button" data-lane-id="${escapeHtml(lane.id)}" data-zone-id="${escapeHtml(zone.id)}">
        <span class="target-lane__label">${escapeHtml(lane.label)}</span>
        <span class="target-lane__badge">${selectedCount}/${totalCount}ロット / ${formatNum(selectedTrays)}枚${capacity > 0 ? ` / 目安${formatNum(capacity)}枚` : ""}</span>
      </button>
      <div class="target-lane__body">
        ${expanded ? renderLaneLots(lots) : `<div class="target-lane__hint">クリックすると対象ロットを表示します</div>`}
        ${overBy > 0 ? `<div class="target-lane__warning">目安上限を ${formatNum(overBy)} 枚超えています。並べ方によっては許容できる場合があります。</div>` : ""}
      </div>
      <div class="target-lane__footer">
        <button class="secondary-btn" type="button" data-lane-clear="${escapeHtml(lane.id)}">このレーンを解除</button>
      </div>
    </section>
  `;
}

function renderLaneLots(lots) {
  if (!lots.length) {
    return `<div class="target-lane__empty">対象ロットがありません</div>`;
  }

  return `
    <div class="target-lot-list">
      ${lots.map(lot => {
        const selected = selectedSeedRefs.has(lot.seedRef);
        return `
          <article class="target-lot ${selected ? "is-selected" : ""}">
            <div class="target-lot__main">
              <div class="target-lot__name">${escapeHtml(lot.variety)}</div>
              <div class="target-lot__meta">${escapeHtml(lot.seedRef)} / 播種日 ${escapeHtml(formatSeedDateLabel(lot.seedDate, lot.seedRef))}</div>
              <div class="target-lot__meta">${formatNum(lot.trays)} 枚${lot.blockCount > 1 ? `（${lot.blockCount}ブロック）` : ""}</div>
            </div>
            <button class="target-lot__remove" type="button" data-remove-seed-ref="${escapeHtml(lot.seedRef)}" data-remove-lane-id="${escapeHtml(lot.laneId)}">×</button>
          </article>
        `;
      }).join("")}
    </div>
  `;
}

function updateSummary() {
  const el = document.getElementById("nursery-target-summary");
  if (!el) return;

  const selected = getSelectedTargets();
  if (selected.length === 0) {
    el.innerHTML = "<strong>未選択</strong> <span>レーンを開いて対象ロットを選択してください。</span>";
    return;
  }

  const labels = selected.map(v => `${v.laneLabel}:${v.variety}`);
  const warnings = getCapacityWarnings();
  const totalTrays = selected.reduce((sum, item) => sum + toNumber(item.trays), 0);
  const base = labels.length <= 4
    ? `選択中: ${labels.join("、")}`
    : `選択中: ${labels.slice(0, 4).join("、")} ほか${labels.length - 4}件`;

  el.innerHTML = warnings.length
    ? `<strong>${formatNum(selected.length)}ロット / ${formatNum(totalTrays)}枚</strong><br>${escapeHtml(base)}<br><span class="target-summary__warn">${escapeHtml(warnings.join(" / "))}</span>`
    : `<strong>${formatNum(selected.length)}ロット / ${formatNum(totalTrays)}枚</strong><br>${escapeHtml(base)}`;
}

function toggleLaneSelection(laneId) {
  const lots = targetState.laneLotsByLane.get(laneId) || [];
  if (!lots.length) {
    alert("このレーンに対象ロットがありません。");
    return;
  }

  const allSelected = lots.every(lot => selectedSeedRefs.has(lot.seedRef));
  if (allSelected) {
    clearLaneSelection(laneId);
  } else {
    lots.forEach(lot => selectedSeedRefs.add(lot.seedRef));
    renderTargetArea();
    updateSummary();
  }
}

function clearLaneSelection(laneId) {
  const lots = targetState.laneLotsByLane.get(laneId) || [];
  lots.forEach(lot => selectedSeedRefs.delete(lot.seedRef));
  renderTargetArea();
  updateSummary();
}

function setZoneSelection(zoneId, enabled) {
  const zone = NURSERY_TARGET_GROUPS.find(v => v.id === zoneId);
  if (!zone) return;

  zone.lanes.forEach(lane => {
    const lots = targetState.laneLotsByLane.get(lane.id) || [];
    lots.forEach(lot => {
      if (enabled) selectedSeedRefs.add(lot.seedRef);
      else selectedSeedRefs.delete(lot.seedRef);
    });
  });

  renderTargetArea();
  updateSummary();
}

function removeSeedRef(seedRef, laneId) {
  if (!seedRef) return;

  selectedSeedRefs.delete(seedRef);

  const lots = targetState.laneLotsByLane.get(laneId) || [];
  if (lots.every(lot => !selectedSeedRefs.has(lot.seedRef))) {
    clearLaneSelection(laneId);
    return;
  }

  renderTargetArea();
  updateSummary();
}

function getSelectedTargets() {
  const ordered = [];
  NURSERY_TARGET_GROUPS.forEach(zone => {
    zone.lanes.forEach(lane => {
      const lots = targetState.laneLotsByLane.get(lane.id) || [];
      lots.forEach(lot => {
        if (!selectedSeedRefs.has(lot.seedRef)) return;
        ordered.push({
          seedRef: lot.seedRef,
          laneId: lot.laneId,
          laneLabel: lane.label,
          zoneId: zone.id,
          zoneLabel: zone.label,
          variety: lot.variety,
          trays: lot.trays,
          seedDate: lot.seedDate
        });
      });
    });
  });
  return ordered;
}

function getCapacityWarnings() {
  const warnings = [];

  NURSERY_TARGET_GROUPS.forEach(zone => {
    zone.lanes.forEach(lane => {
      const lots = targetState.laneLotsByLane.get(lane.id) || [];
      const selectedTrays = lots
        .filter(lot => selectedSeedRefs.has(lot.seedRef))
        .reduce((sum, lot) => sum + toNumber(lot.trays), 0);
      const capacity = toNumber(lane.capacity);

      if (capacity > 0 && selectedTrays > capacity) {
        warnings.push(`${lane.label} は目安上限 +${formatNum(selectedTrays - capacity)}枚`);
      }
    });
  });

  return warnings;
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
    alert("対象レーンを選択してください");
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
    ? targets.map(v => `${v.laneLabel}:${v.variety}`).join("、")
    : `${targets.slice(0, 4).map(v => `${v.laneLabel}:${v.variety}`).join("、")} ほか${targets.length - 4}件`;
  const warnings = getCapacityWarnings();

  const confirmed = await confirmSaveBeforeSubmit({
    lines: [
      `日付: ${date}`,
      `対象: ${targetLabel}`,
      `作業者: ${workers}`,
      `農薬件数: ${pesticides.length}件`,
      ...(warnings.length ? [warnings.join(" / ")] : [])
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

function buildLots(seedRows, plantingRows, discardPlantingRows, discardSeedRows, legacyNurseryRows = []) {
  const plantedMap = buildPlantedTrayMap(plantingRows);
  const discardedPlantingMap = buildDiscardedTrayMap(plantingRows, discardPlantingRows);
  const discardedSeedMap = buildSeedDiscardTrayMap(discardSeedRows, legacyNurseryRows);

  return seedRows
    .map(row => {
      const seedRef = String(row.seedRef || "").trim();
      if (!seedRef) return null;

      const totalTrays = toNumber(row.trayCount);
      const plantedTrays = toNumber(plantedMap.get(seedRef) || 0);
      const discardedTrays = toNumber(discardedPlantingMap.get(seedRef) || 0) + toNumber(discardedSeedMap.get(seedRef) || 0);
      const availableTrays = Math.max(0, totalTrays - plantedTrays - discardedTrays);

      return {
        seedRef,
        seedDate: String(row.seedDate || "").trim(),
        seedDateMs: parseDateMs(row.seedDate),
        variety: String(row.varietyName || "(品種未設定)").trim(),
        trayType: String(row.trayType || "-").trim(),
        totalTrays,
        plantedTrays,
        discardedTrays,
        availableTrays
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const cmp = b.availableTrays - a.availableTrays;
      if (cmp !== 0) return cmp;
      return a.seedRef.localeCompare(b.seedRef, "ja");
    });
}

function buildPlantedTrayMap(plantingRows) {
  const map = new Map();

  plantingRows.forEach(row => {
    const refs = splitSeedRefs(row.seedRef);
    if (!refs.length) return;

    const trayType = toNumber(row.trayType) || 128;
    let trays = toNumber(row.trayCount);
    if (trays <= 0) {
      const qty = toNumber(row.quantity);
      trays = trayType > 0 ? qty / trayType : 0;
    }

    const perRef = refs.length > 0 ? trays / refs.length : 0;
    refs.forEach(ref => {
      map.set(ref, toNumber(map.get(ref) || 0) + perRef);
    });
  });

  return map;
}

function buildDiscardedTrayMap(plantingRows, discardRows) {
  const map = new Map();
  const plantingByRef = new Map();

  plantingRows.forEach(row => {
    const pRef = String(row.plantingRef || "").trim();
    if (pRef) plantingByRef.set(pRef, row);
  });

  discardRows.forEach(row => {
    const pRef = String(row.plantingRef || "").trim();
    const planting = plantingByRef.get(pRef);
    if (!planting) return;

    const refs = splitSeedRefs(planting.seedRef);
    if (!refs.length) return;

    const trayType = toNumber(planting.trayType) || 128;
    const discardPlants = toNumber(row.discardQuantity || row.discard || 0);
    const discardTrays = trayType > 0 ? discardPlants / trayType : 0;
    const perRef = refs.length > 0 ? discardTrays / refs.length : 0;

    refs.forEach(ref => {
      map.set(ref, toNumber(map.get(ref) || 0) + perRef);
    });
  });

  return map;
}

function buildSeedDiscardTrayMap(discardSeedRows, legacyNurseryRows = []) {
  const map = new Map();

  (Array.isArray(discardSeedRows) ? discardSeedRows : []).forEach(row => {
    const ref = String(row.seedRef || "").trim();
    if (!ref) return;

    let trays = toNumber(row.discardTrays);
    if (trays <= 0) {
      const qty = toNumber(row.discardQuantity || row.discard || 0);
      const trayType = toNumber(row.trayType) || 0;
      trays = trayType > 0 ? qty / trayType : 0;
    }
    if (trays <= 0) return;

    map.set(ref, toNumber(map.get(ref) || 0) + trays);
  });

  (Array.isArray(legacyNurseryRows) ? legacyNurseryRows : []).forEach(row => {
    const ref = String(row.seedRef || "").trim();
    if (!ref) return;

    const trays = toNumber(row.discard);
    if (trays <= 0) return;
    map.set(ref, toNumber(map.get(ref) || 0) + trays);
  });

  return map;
}

function splitSeedRefs(raw) {
  return String(raw || "")
    .split(/[\/／,]/)
    .map(v => String(v || "").trim())
    .filter(Boolean);
}

function toNumber(v) {
  const n = Number(String(v ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

function parseDateMs(v) {
  const raw = String(v || "").trim();
  if (!raw) return 0;

  const ms = Date.parse(raw);
  if (Number.isFinite(ms)) return ms;

  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 8) return 0;

  const y = Number(digits.slice(0, 4));
  const m = Number(digits.slice(4, 6));
  const d = Number(digits.slice(6, 8));
  const t = new Date(y, Math.max(0, m - 1), d).getTime();
  return Number.isFinite(t) ? t : 0;
}

function formatSeedDateLabel(seedDate, seedRef = "") {
  const raw = String(seedDate || "").trim();
  if (raw) return raw;

  const ref = String(seedRef || "").trim();
  const m = ref.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return "日付なし";

  return `${m[1]}-${m[2]}-${m[3]}`;
}

function roundTray(v) {
  return Math.max(0, Math.round(v * 10) / 10);
}

function getZoneByLaneId(laneId) {
  if (String(laneId || "").startsWith("east-")) return "east";
  if (String(laneId || "").startsWith("west-")) return "west";
  if (String(laneId || "").startsWith("outside-")) return "outside";
  return "";
}

function getZoneLabelByLaneId(laneId) {
  const zoneId = getZoneByLaneId(laneId);
  return NURSERY_TARGET_GROUPS.find(v => v.id === zoneId)?.label || "";
}

function findLane(laneId) {
  return NURSERY_TARGET_GROUPS.flatMap(group => group.lanes).find(v => v.id === laneId) || null;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}