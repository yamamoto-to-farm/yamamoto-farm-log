import { loadCSV, normalizeKeys } from "/common/csv.js";
import { loadJSON, saveJSON } from "/common/json.js";

const LAYOUT_PATH = "logs/nursery/house-layout.json";

const ZONES = [
  { id: "house-west", title: "育苗ハウス 西側", kind: "house", columns: 4, rows: 10 },
  { id: "house-center", title: "育苗ハウス 中央", kind: "house", columns: 4, rows: 8 },
  { id: "house-east", title: "育苗ハウス 東側", kind: "house", columns: 3, rows: 10 },
  { id: "outside-east", title: "外育苗 東側新設", kind: "outside", columns: 5, rows: 4 }
];

let lots = [];
let assignments = {};
let searchKeyword = "";
let showZeroLots = false;
let dragSeedRef = "";

export async function initNurseryHousePage() {
  bindControls();
  await reloadAll();
}

function bindControls() {
  const searchEl = document.getElementById("lot-search");
  const showEmptyEl = document.getElementById("show-empty-lots");
  const reloadBtn = document.getElementById("reload-btn");
  const saveBtn = document.getElementById("save-btn");
  const unassignedPool = document.getElementById("unassigned-pool");

  searchEl?.addEventListener("input", () => {
    searchKeyword = String(searchEl.value || "").trim().toLowerCase();
    render();
  });

  showEmptyEl?.addEventListener("change", () => {
    showZeroLots = !!showEmptyEl.checked;
    render();
  });

  reloadBtn?.addEventListener("click", async () => {
    await reloadAll();
  });

  saveBtn?.addEventListener("click", async () => {
    await saveLayout();
  });

  if (unassignedPool) {
    unassignedPool.addEventListener("dragover", e => {
      e.preventDefault();
      unassignedPool.classList.add("drag-over");
    });

    unassignedPool.addEventListener("dragleave", () => {
      unassignedPool.classList.remove("drag-over");
    });

    unassignedPool.addEventListener("drop", e => {
      e.preventDefault();
      unassignedPool.classList.remove("drag-over");
      if (!dragSeedRef) return;
      delete assignments[dragSeedRef];
      render();
    });
  }
}

async function reloadAll() {
  const [seedRaw, plantingRaw, discardRaw, layout] = await Promise.all([
    loadCSV("/logs/seed/all.csv").catch(() => []),
    loadCSV("/logs/planting/all.csv").catch(() => []),
    loadCSV("/logs/discard-planting/all.csv").catch(() => []),
    loadLayout()
  ]);

  const seedRows = normalizeKeys(seedRaw || []);
  const plantingRows = normalizeKeys(plantingRaw || []);
  const discardRows = normalizeKeys(discardRaw || []);

  assignments = sanitizeAssignments(layout?.assignments || {});
  lots = buildLots(seedRows, plantingRows, discardRows);
  assignments = dropUnknownAssignments(assignments, lots);

  render();
}

async function loadLayout() {
  try {
    return await loadJSON(`/${LAYOUT_PATH}`);
  } catch {
    return { version: 1, assignments: {} };
  }
}

async function saveLayout() {
  try {
    const payload = {
      version: 1,
      updatedAt: new Date().toISOString(),
      assignments
    };
    await saveJSON(LAYOUT_PATH, payload);
    alert("配置を保存しました。");
  } catch (e) {
    alert(`保存に失敗しました: ${String(e?.message || e)}`);
  }
}

function buildLots(seedRows, plantingRows, discardRows) {
  const plantedMap = buildPlantedTrayMap(plantingRows);
  const discardedMap = buildDiscardedTrayMap(plantingRows, discardRows);

  return seedRows
    .map(row => {
      const seedRef = String(row.seedRef || "").trim();
      if (!seedRef) return null;

      const totalTrays = toNumber(row.trayCount);
      const plantedTrays = toNumber(plantedMap.get(seedRef) || 0);
      const discardedTrays = toNumber(discardedMap.get(seedRef) || 0);
      const availableTrays = Math.max(0, totalTrays - plantedTrays - discardedTrays);

      return {
        seedRef,
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
    const discardTrays = trayType > 0 ? (discardPlants / trayType) : 0;
    const perRef = refs.length > 0 ? discardTrays / refs.length : 0;

    refs.forEach(ref => {
      map.set(ref, toNumber(map.get(ref) || 0) + perRef);
    });
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

function sanitizeAssignments(raw) {
  const next = {};
  Object.keys(raw || {}).forEach(seedRef => {
    const value = raw[seedRef];
    const zoneId = String(value?.zoneId || "").trim();
    const slotIndex = Number(value?.slotIndex);
    if (!zoneId || !Number.isInteger(slotIndex) || slotIndex < 0) return;
    if (!findZone(zoneId)) return;
    if (slotIndex >= zoneSlotCount(zoneId)) return;
    next[seedRef] = { zoneId, slotIndex };
  });
  return next;
}

function dropUnknownAssignments(currentAssignments, lotRows) {
  const known = new Set((lotRows || []).map(v => v.seedRef));
  const next = {};
  Object.keys(currentAssignments || {}).forEach(seedRef => {
    if (!known.has(seedRef)) return;
    next[seedRef] = currentAssignments[seedRef];
  });
  return next;
}

function render() {
  renderSummary();
  renderUnassignedPool();
  renderZones();
}

function renderSummary() {
  const total = lots.length;
  const active = lots.filter(v => v.availableTrays > 0).length;
  const assigned = Object.keys(assignments).length;
  const line = document.getElementById("summary-line");
  if (line) {
    line.textContent = `ロット ${total}件 / 在庫あり ${active}件 / 配置済み ${assigned}件`;
  }

  const staleSeedRefs = Object.keys(assignments).filter(seedRef => {
    const lot = lots.find(v => v.seedRef === seedRef);
    return !!lot && lot.availableTrays <= 0;
  });
  const staleLine = document.getElementById("stale-line");
  if (!staleLine) return;

  if (!staleSeedRefs.length) {
    staleLine.style.display = "none";
    staleLine.textContent = "";
    return;
  }

  staleLine.style.display = "block";
  staleLine.textContent = `注意: 在庫0の配置が ${staleSeedRefs.length}件あります（収穫・定植・破棄反映後）。`;
}

function renderUnassignedPool() {
  const root = document.getElementById("unassigned-pool");
  if (!root) return;

  root.innerHTML = "";
  const assignedSeedRefs = new Set(Object.keys(assignments));

  const filtered = lots.filter(lot => {
    const text = `${lot.variety} ${lot.seedRef}`.toLowerCase();
    if (searchKeyword && !text.includes(searchKeyword)) return false;
    if (!showZeroLots && lot.availableTrays <= 0) return false;
    return !assignedSeedRefs.has(lot.seedRef);
  });

  if (!filtered.length) {
    root.innerHTML = '<p class="empty-note">未配置ロットはありません。</p>';
    return;
  }

  filtered.forEach(lot => {
    root.appendChild(buildLotCard(lot));
  });
}

function renderZones() {
  const root = document.getElementById("zones-root");
  if (!root) return;

  root.innerHTML = "";
  const bySlot = buildBySlotMap();

  ZONES.forEach(zone => {
    const card = document.createElement("section");
    card.className = `zone-card kind-${zone.kind}`;

    const title = document.createElement("h3");
    title.className = "zone-title";
    title.textContent = `${zone.title} (${zone.columns}列 × ${zone.rows}段)`;
    card.appendChild(title);

    const grid = document.createElement("div");
    grid.className = "zone-grid";
    grid.style.gridTemplateColumns = `repeat(${zone.columns}, minmax(0, 1fr))`;

    const totalSlots = zone.columns * zone.rows;
    for (let slotIndex = 0; slotIndex < totalSlots; slotIndex++) {
      const slot = document.createElement("div");
      slot.className = "slot";
      slot.dataset.zoneId = zone.id;
      slot.dataset.slotIndex = String(slotIndex);

      const label = document.createElement("div");
      label.className = "slot-label";
      label.textContent = `${(slotIndex % zone.columns) + 1}列-${Math.floor(slotIndex / zone.columns) + 1}`;

      const body = document.createElement("div");
      body.className = "slot-body";
      body.style.width = "100%";

      slot.appendChild(body);

      const key = `${zone.id}::${slotIndex}`;
      const seedRef = bySlot.get(key);
      if (seedRef) {
        const lot = lots.find(v => v.seedRef === seedRef);
        if (lot) {
          slot.classList.add("filled");
          body.appendChild(label);
          body.appendChild(buildLotCard(lot));
        }
      } else {
        body.appendChild(label);
      }

      bindSlotDnD(slot);
      grid.appendChild(slot);
    }

    card.appendChild(grid);
    root.appendChild(card);
  });
}

function buildBySlotMap() {
  const map = new Map();
  Object.keys(assignments || {}).forEach(seedRef => {
    const a = assignments[seedRef];
    map.set(`${a.zoneId}::${a.slotIndex}`, seedRef);
  });
  return map;
}

function buildLotCard(lot) {
  const card = document.createElement("article");
  card.className = "lot-card";
  if (lot.availableTrays <= 0) card.classList.add("zero");
  if (lot.availableTrays > 0 && lot.availableTrays < 5) card.classList.add("warn");
  card.draggable = true;
  card.dataset.seedRef = lot.seedRef;

  card.innerHTML = `
    <div class="lot-name">${escapeHtml(lot.variety)}</div>
    <div class="lot-ref">${escapeHtml(lot.seedRef)}</div>
    <div class="lot-meta">在庫 ${formatNum(lot.availableTrays)} 枚 / 播種 ${formatNum(lot.totalTrays)} 枚</div>
    <div class="lot-meta">定植 ${formatNum(lot.plantedTrays)} / 破棄 ${formatNum(lot.discardedTrays)} / ${escapeHtml(lot.trayType)}穴</div>
  `;

  card.addEventListener("dragstart", e => {
    dragSeedRef = lot.seedRef;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", lot.seedRef);
    }
  });

  card.addEventListener("dragend", () => {
    dragSeedRef = "";
  });

  return card;
}

function bindSlotDnD(slot) {
  slot.addEventListener("dragover", e => {
    e.preventDefault();
    slot.classList.add("drag-over");
  });

  slot.addEventListener("dragleave", () => {
    slot.classList.remove("drag-over");
  });

  slot.addEventListener("drop", e => {
    e.preventDefault();
    slot.classList.remove("drag-over");

    const seedRef = dragSeedRef || String(e.dataTransfer?.getData("text/plain") || "").trim();
    if (!seedRef) return;

    const zoneId = String(slot.dataset.zoneId || "").trim();
    const slotIndex = Number(slot.dataset.slotIndex);
    if (!zoneId || !Number.isInteger(slotIndex)) return;

    const occupant = findSeedRefAt(zoneId, slotIndex);
    const prev = assignments[seedRef] || null;

    assignments[seedRef] = { zoneId, slotIndex };

    if (occupant && occupant !== seedRef) {
      if (prev) assignments[occupant] = prev;
      else delete assignments[occupant];
    }

    render();
  });
}

function findSeedRefAt(zoneId, slotIndex) {
  const target = `${zoneId}::${slotIndex}`;
  return Object.keys(assignments).find(seedRef => {
    const a = assignments[seedRef];
    return `${a.zoneId}::${a.slotIndex}` === target;
  }) || "";
}

function findZone(zoneId) {
  return ZONES.find(v => v.id === zoneId) || null;
}

function zoneSlotCount(zoneId) {
  const zone = findZone(zoneId);
  if (!zone) return 0;
  return zone.columns * zone.rows;
}

function formatNum(v) {
  return Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
