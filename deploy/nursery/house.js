import { loadCSV, normalizeKeys } from "/common/csv.js";
import { loadJSON, saveJSON } from "/common/json.js";

const LAYOUT_PATH = "logs/nursery/house-layout.json";

const TRAY_WIDTH_MM = 300;
const TRAY_LENGTH_MM = 600;
const MM_TO_PX = 0.0052;

const GROUPS = [
  {
    id: "west-house",
    title: "育苗ハウス　西棟",
    kind: "house",
    lanes: [
      { id: "west-1", label: "西①", capacity: 240, trayCols: 3 },
      { id: "west-2", label: "西②", capacity: 160, trayCols: 2 },
      { id: "west-3", label: "西③", capacity: 160, trayCols: 2 },
      { id: "west-4", label: "西④", capacity: 240, trayCols: 3 }
    ]
  },
  {
    id: "east-house",
    title: "育苗ハウス　東棟",
    kind: "house",
    lanes: [
      { id: "east-1", label: "東①", capacity: 366, trayCols: 3 },
      { id: "east-2", label: "東②", capacity: 610, trayCols: 5 },
      { id: "east-3", label: "東③", capacity: 366, trayCols: 3 }
    ]
  },
  {
    id: "outside-area",
    title: "外育苗場所",
    kind: "outside",
    lanes: [
      { id: "outside-1", label: "外①", capacity: 162, trayCols: 3 },
      { id: "outside-2", label: "外②", capacity: 108, trayCols: 3 },
      { id: "outside-3", label: "外③", capacity: 75, trayCols: 3 },
      { id: "outside-4", label: "外④", capacity: 324, trayCols: 3 },
      { id: "outside-5", label: "外⑤", capacity: 300, trayCols: 3 }
    ]
  }
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
    const laneId = String(value?.laneId || "").trim();
    const order = Number(value?.order);

    if (laneId && Number.isInteger(order) && order >= 0 && findLane(laneId)) {
      next[seedRef] = { laneId, order };
      return;
    }

    const migrated = migrateLegacyAssignment(value);
    if (migrated) {
      next[seedRef] = migrated;
    }
  });
  return next;
}

function migrateLegacyAssignment(value) {
  const zoneId = String(value?.zoneId || "").trim();
  const slotIndex = Number(value?.slotIndex);
  if (!zoneId || !Number.isInteger(slotIndex) || slotIndex < 0) return null;

  if (zoneId === "house-west") {
    return {
      laneId: `west-${(slotIndex % 4) + 1}`,
      order: Math.floor(slotIndex / 4)
    };
  }

  if (zoneId === "house-center") {
    return {
      laneId: `west-${(slotIndex % 4) + 1}`,
      order: 100 + Math.floor(slotIndex / 4)
    };
  }

  if (zoneId === "house-east") {
    return {
      laneId: `east-${(slotIndex % 3) + 1}`,
      order: Math.floor(slotIndex / 3)
    };
  }

  if (zoneId === "outside-east") {
    return {
      laneId: `outside-${(slotIndex % 5) + 1}`,
      order: Math.floor(slotIndex / 5)
    };
  }

  return null;
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
  renderGroups();
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

function renderGroups() {
  const root = document.getElementById("zones-root");
  if (!root) return;

  root.innerHTML = "";
  const byLane = buildLaneMap();

  const westGroup = GROUPS.find(group => group.id === "west-house");
  const eastGroup = GROUPS.find(group => group.id === "east-house");
  const outsideGroup = GROUPS.find(group => group.id === "outside-area");

  if (outsideGroup) {
    const sideLanes = ["outside-4", "outside-5", "outside-3"]
      .map(id => outsideGroup.lanes.find(lane => lane.id === id))
      .filter(Boolean);
    const bottomLanes = ["outside-2", "outside-1"]
      .map(id => outsideGroup.lanes.find(lane => lane.id === id))
      .filter(Boolean);

    if (sideLanes.length) {
      root.appendChild(buildGroupCard(
        {
          id: "outside-side",
          kind: "outside",
          title: "",
          lanes: sideLanes
        },
        byLane,
        {
          cardClass: "outside-side-card",
          laneGridClass: "layout-outside-side",
          showTitle: false
        }
      ));
    }

    if (bottomLanes.length) {
      root.appendChild(buildGroupCard(
        {
          id: "outside-bottom",
          kind: "outside",
          title: "",
          lanes: bottomLanes
        },
        byLane,
        {
          cardClass: "outside-bottom-card is-wide",
          laneGridClass: "layout-outside-bottom",
          showTitle: false
        }
      ));
    }
  }

  if (westGroup) {
    root.appendChild(buildGroupCard(westGroup, byLane));
  }
  if (eastGroup) {
    root.appendChild(buildGroupCard(eastGroup, byLane));
  }
}

function buildGroupCard(group, byLane, options = {}) {
  const { cardClass = "", laneGridClass = "", showTitle = true } = options;
  const groupClass = `group-${String(group.id || "").replace(/[^a-z0-9_-]/gi, "-")}`;

  const card = document.createElement("section");
  card.className = `zone-card group-card kind-${group.kind} ${groupClass} ${cardClass}`.trim();

  if (showTitle && group.title) {
    const title = document.createElement("h3");
    title.className = "zone-title group-title";
    title.textContent = group.title;
    card.appendChild(title);
  }

  const grid = document.createElement("div");
  grid.className = `lane-grid ${laneGridClass}`.trim();
  if (!laneGridClass || laneGridClass === "layout-outside-bottom") {
    const colTemplate = group.lanes
      .map(lane => `${getLaneWidthUnits(lane)}fr`)
      .join(" ");
    grid.style.gridTemplateColumns = colTemplate || `repeat(${group.lanes.length}, minmax(0, 1fr))`;
  }

  group.lanes.forEach(lane => {
    grid.appendChild(buildLaneElement(lane, byLane));
  });

  card.appendChild(grid);
  return card;
}

function buildLaneElement(lane, byLane) {
  const laneEl = document.createElement("section");
  const laneClass = `lane-${String(lane.id || "").replace(/[^a-z0-9_-]/gi, "-")}`;
  laneEl.className = `lane ${laneClass}`;
  laneEl.dataset.laneId = lane.id;
  laneEl.style.setProperty("--lane-cols", String(getLaneCols(lane)));
  laneEl.style.setProperty("--lane-rows", String(getLaneRows(lane)));

  const laneLots = (byLane.get(lane.id) || []).map(seedRef => lots.find(v => v.seedRef === seedRef)).filter(Boolean);
  const used = laneLots.reduce((sum, lot) => sum + lot.availableTrays, 0);

  laneEl.innerHTML = `
    <div class="lane-head">
      <div class="lane-name">${escapeHtml(lane.label)} ${lane.capacity ? `${formatNum(lane.capacity)}枚` : ""}</div>
      <div class="lane-meta">トレイ${getLaneCols(lane)}列</div>
      <div class="lane-usage">${lane.capacity ? `使用 ${formatNum(used)} / ${formatNum(lane.capacity)}` : `配置 ${laneLots.length}件`}</div>
    </div>
  `;

  const body = document.createElement("div");
  body.className = "lane-body drop-pool";
  body.dataset.laneId = lane.id;
  body.style.height = `${computeLaneBodyHeight(lane)}px`;
  bindLaneDrop(body, lane.id, "");

  if (!laneLots.length) {
    const empty = document.createElement("div");
    empty.className = "lane-empty";
    empty.textContent = "ここへ配置";
    body.appendChild(empty);
  } else {
    laneLots.forEach(lot => {
      const item = document.createElement("div");
      item.className = "lane-item";
      item.dataset.seedRef = lot.seedRef;
      bindLaneDrop(item, lane.id, lot.seedRef);
      item.appendChild(buildLotCard(lot, lane));
      body.appendChild(item);
    });
  }

  laneEl.appendChild(body);
  return laneEl;
}

function buildLaneMap() {
  const map = new Map();
  allLanes().forEach(lane => map.set(lane.id, []));

  Object.keys(assignments || {}).forEach(seedRef => {
    const placement = assignments[seedRef];
    if (!placement?.laneId || !map.has(placement.laneId)) return;
    map.get(placement.laneId).push({ seedRef, order: Number(placement.order || 0) });
  });

  map.forEach((items, laneId) => {
    items.sort((a, b) => a.order - b.order);
    map.set(laneId, items.map(v => v.seedRef));
  });

  return map;
}

function buildLotCard(lot, lane = null) {
  const card = document.createElement("article");
  card.className = "lot-card";
  if (lot.availableTrays <= 0) card.classList.add("zero");
  if (lot.availableTrays > 0 && lot.availableTrays < 5) card.classList.add("warn");
  card.draggable = true;
  card.dataset.seedRef = lot.seedRef;
  if (lane) {
    const height = computeBlockHeight(lot, lane);
    card.style.height = `${height}px`;
  }

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

function bindLaneDrop(el, laneId, beforeSeedRef) {
  el.addEventListener("dragover", e => {
    e.preventDefault();
    el.classList.add("drag-over");
  });

  el.addEventListener("dragleave", () => {
    el.classList.remove("drag-over");
  });

  el.addEventListener("drop", e => {
    e.preventDefault();
    el.classList.remove("drag-over");

    const seedRef = dragSeedRef || String(e.dataTransfer?.getData("text/plain") || "").trim();
    if (!seedRef) return;
    placeSeedRef(seedRef, laneId, beforeSeedRef);
    render();
  });
}

function placeSeedRef(seedRef, laneId, beforeSeedRef = "") {
  const lanes = buildLaneMap();
  lanes.forEach((seedRefs, currentLaneId) => {
    lanes.set(currentLaneId, seedRefs.filter(ref => ref !== seedRef));
  });

  const target = [...(lanes.get(laneId) || [])];
  const beforeIndex = beforeSeedRef ? target.indexOf(beforeSeedRef) : -1;
  if (beforeIndex >= 0) {
    target.splice(beforeIndex, 0, seedRef);
  } else {
    target.push(seedRef);
  }
  lanes.set(laneId, target);

  assignments = {};
  lanes.forEach((seedRefs, currentLaneId) => {
    seedRefs.forEach((ref, index) => {
      assignments[ref] = { laneId: currentLaneId, order: index };
    });
  });
}

function findLane(laneId) {
  return allLanes().find(v => v.id === laneId) || null;
}

function allLanes() {
  return GROUPS.flatMap(group => group.lanes);
}

function getLaneCols(lane) {
  return Math.max(1, toNumber(lane?.trayCols) || 3);
}

function getLaneRows(lane) {
  const cols = getLaneCols(lane);
  const capacity = toNumber(lane?.capacity);
  if (capacity <= 0) return 24;
  return Math.max(1, capacity / cols);
}

function getLaneWidthUnits(lane) {
  return getLaneCols(lane) * TRAY_WIDTH_MM;
}

function computeLaneBodyHeight(lane) {
  // Physical scaling based on one tray size (300mm x 600mm).
  const rows = getLaneRows(lane);
  const px = rows * TRAY_LENGTH_MM * MM_TO_PX;
  return clamp(Math.round(px), 96, 460);
}

function computeBlockHeight(lot, lane) {
  const cols = getLaneCols(lane || {});
  const trays = Math.max(0, toNumber(lot?.availableTrays));
  if (trays <= 0) return 40;

  const rows = trays / cols;
  const px = rows * TRAY_LENGTH_MM * MM_TO_PX;
  return clamp(Math.round(px), 40, 220);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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
