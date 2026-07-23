import { loadCSV, normalizeKeys } from "/common/csv.js";
import { saveJSON } from "/common/json.js";

const LAYOUT_PATH = "logs/nursery/house-layout.json";

const TRAY_WIDTH_MM = 300;
const TRAY_LENGTH_MM = 600;
const MM_TO_PX = 0.0088;
const SNAP_PX = 12;
const LANE_COL_WIDTH_FACTOR = 24;
const PLACEMENT_EDGE_GAP_PX = 6;
const POINTER_DRAG_THRESHOLD_PX = 8;
const POINTER_HOLD_DELAY_MS = 220;
const POINTER_HOLD_CANCEL_PX = 12;
const POINTER_AUTO_SCROLL_EDGE_PX = 72;
const POINTER_AUTO_SCROLL_MAX_STEP_PX = 22;

const GROUPS = [
  {
    id: "west-house",
    title: "育苗ハウス　西棟",
    kind: "house",
    lanes: [
      { id: "west-1", label: "西①", capacity: 240, trayCols: 3, shortEdgeAxis: "ew" },
      { id: "west-2", label: "西②", capacity: 160, trayCols: 2, shortEdgeAxis: "ew" },
      { id: "west-3", label: "西③", capacity: 160, trayCols: 2, shortEdgeAxis: "ew" },
      { id: "west-4", label: "西④", capacity: 240, trayCols: 3, shortEdgeAxis: "ew" }
    ]
  },
  {
    id: "east-house",
    title: "育苗ハウス　東棟",
    kind: "house",
    lanes: [
      { id: "east-1", label: "東①", capacity: 366, trayCols: 3, shortEdgeAxis: "ew" },
      { id: "east-2", label: "東②", capacity: 610, trayCols: 5, shortEdgeAxis: "ew" },
      { id: "east-3", label: "東③", capacity: 366, trayCols: 3, shortEdgeAxis: "ew" }
    ]
  },
  {
    id: "outside-area",
    title: "外育苗場所",
    kind: "outside",
    lanes: [
      { id: "outside-1", label: "外①", capacity: 162, trayCols: 3, shortEdgeAxis: "ns" },
      { id: "outside-2", label: "外②", capacity: 108, trayCols: 3, shortEdgeAxis: "ns" },
      { id: "outside-3", label: "外③", capacity: 75, trayCols: 3, shortEdgeAxis: "ns" },
      { id: "outside-4", label: "外④", capacity: 324, trayCols: 3, shortEdgeAxis: "ew" },
      { id: "outside-5", label: "外⑤", capacity: 300, trayCols: 3, shortEdgeAxis: "ew" }
    ]
  }
];

let lots = [];
let lotsBySeedRef = new Map();
let blocks = [];
let focusedLaneId = "";
let dragBlockId = "";
let dragBlockIds = [];
let modalBlockId = "";
let modalMoveZone = "";
let modalMoveExpanded = false;
let multiSelectMode = false;
const selectedBlockIds = new Set();
let currentView = "all";
let lockedView = "";
let dragPreview = null;
let currentMode = "overview";
let currentZone = "";
let currentLaneId = "";
let suppressClickUntil = 0;

const pointerDragState = {
  active: false,
  started: false,
  pointerId: null,
  pointerType: "mouse",
  blockId: "",
  blockIds: [],
  startX: 0,
  startY: 0,
  latestX: 0,
  latestY: 0,
  holdReady: false,
  holdTimer: 0,
  autoScrollRaf: 0,
  originCard: null,
  hoverEl: null,
  hoverLaneId: "",
  hoverBeforeBlockId: "",
  ghostEl: null
};

const VIEW_CONFIG = {
  all: { label: "全体ビュー", groupIds: ["west-house", "east-house", "outside-area"] },
  east: { label: "東棟", groupIds: ["east-house"] },
  west: { label: "西棟", groupIds: ["west-house"] },
  outside: { label: "外", groupIds: ["outside-area"] }
};

const resizeState = {
  active: false,
  blockId: "",
  laneId: "",
  side: "right",
  startX: 0,
  startCols: 1,
  laneCols: 1,
  colPx: 1,
  laneBodyHeight: 0
};

export async function initNurseryHousePage(options = {}) {
  const forcedView = String(options?.forcedView || "").trim().toLowerCase();
  const lockView = !!options?.lockView;
  const route = parseRouteFromLocation();

  if (lockView && VIEW_CONFIG[forcedView]) {
    lockedView = forcedView;
  }

  applyRouteState(route);
  if (lockedView) {
    currentView = lockedView;
    currentZone = lockedView;
    currentMode = "zone";
  }

  document.body.classList.toggle("single-view-mode", !!lockedView);

  bindControls();
  await reloadAll();
}

function bindControls() {
  const reloadBtn = document.getElementById("reload-btn");
  const saveBtn = document.getElementById("save-btn");
  const multiSelectModeBtn = document.getElementById("multi-select-mode-btn");
  const clearSelectionBtn = document.getElementById("clear-selection-btn");
  const openSelectionModalBtn = document.getElementById("open-selection-modal-btn");
  const zonesRoot = document.getElementById("zones-root");
  const modal = document.getElementById("block-modal");
  const modalClose = document.getElementById("block-modal-close");
  const modalCloseBtn = document.getElementById("modal-close-btn");
  const modalDiscardSeedBtn = document.getElementById("modal-discard-seed-btn");
  const modalSplitBtn = document.getElementById("modal-split-btn");
  const modalMergeBtn = document.getElementById("modal-merge-btn");
  const viewButtons = Array.from(document.querySelectorAll("button[data-view]"));

  viewButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const view = String(btn.dataset.view || "all").trim();
      if (view === "all") {
        navigateToRoute({ mode: "overview", zone: "", laneId: "" }, { syncUrl: true });
        return;
      }
      navigateToRoute({ mode: "zone", zone: view, laneId: "" }, { syncUrl: true });
    });
  });

  if (lockedView) {
    viewButtons.forEach(btn => {
      const view = String(btn.dataset.view || "").trim();
      if (view === lockedView) {
        btn.classList.add("is-active");
      } else {
        btn.style.display = "none";
      }
    });
  }

  reloadBtn?.addEventListener("click", async () => {
    await reloadAll();
  });

  saveBtn?.addEventListener("click", async () => {
    await saveLayout();
  });

  multiSelectModeBtn?.addEventListener("click", () => {
    setMultiSelectMode(!multiSelectMode);
  });

  clearSelectionBtn?.addEventListener("click", () => {
    selectedBlockIds.clear();
    render();
  });

  openSelectionModalBtn?.addEventListener("click", () => {
    if (!selectedBlockIds.size) {
      alert("先にブロックを選択してください。");
      return;
    }
    const firstId = [...selectedBlockIds][0];
    openBlockModal(firstId);
  });

  modalClose?.addEventListener("click", closeBlockModal);
  modalCloseBtn?.addEventListener("click", closeBlockModal);
  modalDiscardSeedBtn?.addEventListener("click", () => {
    const block = blocks.find(v => v.blockId === modalBlockId) || null;
    const seedRef = String(block?.originSeedRef || "").trim();
    if (!seedRef) return;
    const returnPath = `${location.pathname}${location.search || ""}`;
    location.href = `/seed/discard-seed.html?ref=${encodeURIComponent(seedRef)}&return=${encodeURIComponent(returnPath)}`;
  });
  modalSplitBtn?.addEventListener("click", () => {
    splitSelectedBlock();
    renderBlockModal();
  });
  modalMergeBtn?.addEventListener("click", () => {
    mergeSelectedBlocks();
    renderBlockModal();
  });

  modal?.addEventListener("click", event => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest("[data-modal-close='true']")) closeBlockModal();

    const categoryBtn = target.closest("[data-move-category]");
    if (categoryBtn instanceof HTMLElement) {
      const category = String(categoryBtn.dataset.moveCategory || "").trim();
      if (category === "pool") {
        moveSelectedBlocksToPool();
        return;
      }
      modalMoveExpanded = true;
      modalMoveZone = normalizeZoneId(category);
      renderBlockModal();
      return;
    }

    const moveToggleBtn = target.closest("[data-move-toggle]");
    if (moveToggleBtn instanceof HTMLElement) {
      modalMoveExpanded = !modalMoveExpanded;
      if (!modalMoveExpanded) {
        modalMoveZone = "";
      }
      renderBlockModal();
      return;
    }

    const autoBtn = target.closest("[data-move-auto-zone]");
    if (autoBtn instanceof HTMLElement) {
      moveSelectedBlocksToZone(String(autoBtn.dataset.moveAutoZone || "").trim());
      return;
    }

    const laneBtn = target.closest("[data-move-lane-id]");
    if (laneBtn instanceof HTMLElement) {
      moveSelectedBlocksToZone(String(laneBtn.dataset.moveZone || "").trim(), String(laneBtn.dataset.moveLaneId || "").trim());
    }
  });

  window.addEventListener("keydown", event => {
    if (event.key === "Escape") closeBlockModal();
  });

  if (!zonesRoot) return;

  zonesRoot.addEventListener("click", event => {
    if (Date.now() < suppressClickUntil) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const target = event.target;
    if (!(target instanceof Element)) return;

    const handle = target.closest(".block-resize-handle");
    if (handle) return;

    const cardEl = target.closest(".lot-card[data-block-id]");
    if (cardEl) {
      const blockId = String(cardEl.getAttribute("data-block-id") || "").trim();
      if (!blockId) return;

      const keyMultiSelect = event.ctrlKey || event.metaKey || event.shiftKey;
      const useMultiSelect = multiSelectMode || keyMultiSelect;
      const keepGroupSelection = !useMultiSelect && selectedBlockIds.size > 1 && selectedBlockIds.has(blockId);

      if (!keepGroupSelection) {
        toggleSelection(blockId, useMultiSelect);
      }

      if (!multiSelectMode || keyMultiSelect) {
        openBlockModal(blockId);
      }

      renderGroups();
      renderSelectionControls();
      return;
    }

    const laneHead = target.closest(".lane-head");
    if (!laneHead) return;

    const laneEl = laneHead.closest(".lane");
    const laneId = String(laneEl?.getAttribute("data-lane-id") || "").trim();
    if (!laneId) return;

    if (currentMode !== "lane") {
      navigateToRoute({ mode: "lane", laneId, zone: getZoneByLaneId(laneId) }, { syncUrl: true });
      return;
    }

    focusedLaneId = focusedLaneId === laneId ? "" : laneId;
    renderGroups();
  });
}

async function reloadAll() {
  const [seedRaw, plantingRaw, discardPlantingRaw, discardSeedRaw, legacyNurseryRaw, layout] = await Promise.all([
    loadCSV("/logs/seed/all.csv").catch(() => []),
    loadCSV("/logs/planting/all.csv").catch(() => []),
    loadCSV("/logs/discard-planting/all.csv").catch(() => []),
    loadCSV("/logs/discard-seed/all.csv").catch(() => []),
    loadCSV("/logs/nursery/all.csv").catch(() => []),
    loadLayout()
  ]);

  const seedRows = normalizeKeys(seedRaw || []);
  const plantingRows = normalizeKeys(plantingRaw || []);
  const discardPlantingRows = normalizeKeys(discardPlantingRaw || []);
  const discardSeedRows = normalizeKeys(discardSeedRaw || []);
  const legacyNurseryRows = normalizeKeys(legacyNurseryRaw || []);

  lots = buildLots(seedRows, plantingRows, discardPlantingRows, discardSeedRows, legacyNurseryRows);
  lotsBySeedRef = new Map(lots.map(lot => [lot.seedRef, lot]));

  blocks = normalizeLayoutBlocks(layout, lotsBySeedRef);
  selectedBlockIds.clear();

  render();
}

async function loadLayout() {
  try {
    const url = `/${LAYOUT_PATH}?ts=${Date.now()}`;
    const res = await fetch(url, { cache: "no-store" });

    if (res.status === 404) {
      return { version: 2, blocks: [], assignments: {} };
    }

    if (!res.ok) {
      throw new Error(`layout fetch failed: ${res.status}`);
    }

    return await res.json();
  } catch {
    return { version: 2, blocks: [], assignments: {} };
  }
}

async function saveLayout() {
  try {
    const payload = {
      version: 2,
      updatedAt: new Date().toISOString(),
      blocks,
      assignments: deriveLegacyAssignments(blocks)
    };
    await saveJSON(LAYOUT_PATH, payload);
    alert("配置を保存しました。");
  } catch (e) {
    alert(`保存に失敗しました: ${String(e?.message || e)}`);
  }
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

function newBlockId(originSeedRef) {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  return `${originSeedRef}#${suffix}`;
}

function normalizeLayoutBlocks(layout, lotMap) {
  const hasBlocks = Array.isArray(layout?.blocks) && layout.blocks.length > 0;
  const sourceBlocks = hasBlocks ? layout.blocks : legacyAssignmentsToBlocks(layout?.assignments || {}, lotMap);

  const grouped = new Map();
  sourceBlocks.forEach((row, index) => {
    const originSeedRef = String(row?.originSeedRef || row?.seedRef || "").trim();
    if (!originSeedRef || !lotMap.has(originSeedRef)) return;

    const trays = roundTray(toNumber(row?.trays));
    if (trays <= 0) return;

    const laneId = String(row?.laneId || "").trim();
    const validLane = laneId && findLane(laneId) ? laneId : "";
    const laneObj = validLane ? findLane(validLane) : null;
    const laneCols = laneObj ? getLaneCols(laneObj) : 1;
    const rawSpan = Math.max(1, Math.floor(toNumber(row?.spanCols) || laneCols));

    const block = {
      blockId: String(row?.blockId || "").trim() || newBlockId(originSeedRef),
      originSeedRef,
      trays,
      laneId: validLane,
      spanCols: laneObj ? getEffectiveSpanCols(laneObj, rawSpan) : Math.min(laneCols, rawSpan),
      posX: Number.isFinite(Number(row?.posX)) ? clamp(toNumber(row?.posX), 0, 1) : NaN,
      posY: Number.isFinite(Number(row?.posY)) ? clamp(toNumber(row?.posY), 0, 1) : NaN,
      order: Number.isFinite(Number(row?.order)) ? Number(row.order) : index
    };

    if (!grouped.has(originSeedRef)) grouped.set(originSeedRef, []);
    grouped.get(originSeedRef).push(block);
  });

  const normalized = [];
  lotMap.forEach((lot, seedRef) => {
    const available = roundTray(toNumber(lot.availableTrays));
    if (available <= 0) return;

    let list = (grouped.get(seedRef) || []).sort((a, b) => a.order - b.order);
    let sum = roundTray(list.reduce((acc, b) => acc + b.trays, 0));

    if (sum > available) {
      let excess = roundTray(sum - available);
      [...list]
        .sort((a, b) => {
          if ((a.laneId ? 1 : 0) !== (b.laneId ? 1 : 0)) return (a.laneId ? 1 : 0) - (b.laneId ? 1 : 0);
          return b.order - a.order;
        })
        .forEach(block => {
          if (excess <= 0) return;
          const cut = Math.min(block.trays, excess);
          block.trays = roundTray(block.trays - cut);
          excess = roundTray(excess - cut);
        });

      list = list.filter(block => block.trays > 0);
      sum = roundTray(list.reduce((acc, b) => acc + b.trays, 0));
    }

    if (sum < available) {
      list.push({
        blockId: newBlockId(seedRef),
        originSeedRef: seedRef,
        trays: roundTray(available - sum),
        laneId: "",
        spanCols: 1,
        posX: 0,
        posY: 0,
        order: list.length
      });
    }

    normalized.push(...list);
  });

  const seen = new Set();
  normalized.forEach((block, idx) => {
    if (!block.blockId || seen.has(block.blockId)) block.blockId = newBlockId(block.originSeedRef);
    seen.add(block.blockId);
    if (!block.laneId) {
      block.spanCols = 1;
      block.posX = 0;
      block.posY = 0;
    } else {
      if (!Number.isFinite(Number(block.posX))) {
        block.posX = clamp((idx % 3) * 0.06, 0, 1);
      } else {
        block.posX = clamp(toNumber(block.posX), 0, 1);
      }

      if (!Number.isFinite(Number(block.posY))) {
        block.posY = clamp(idx * 0.085, 0, 1);
      } else {
        block.posY = clamp(toNumber(block.posY), 0, 1);
      }
    }
    if (!Number.isFinite(Number(block.order))) block.order = idx;
  });

  return normalizeBlockOrders(normalized);
}

function legacyAssignmentsToBlocks(assignments, lotMap) {
  const list = [];
  lotMap.forEach((lot, seedRef) => {
    const legacy = assignments?.[seedRef] || {};
    const laneId = String(legacy.laneId || "").trim();
    const lane = findLane(laneId);
    list.push({
      blockId: newBlockId(seedRef),
      originSeedRef: seedRef,
      trays: roundTray(toNumber(lot.availableTrays)),
      laneId: lane ? lane.id : "",
      spanCols: lane ? getLaneCols(lane) : 1,
      posX: 0,
      posY: 0,
      order: Number.isFinite(Number(legacy.order)) ? Number(legacy.order) : 0
    });
  });
  return list;
}

function deriveLegacyAssignments(currentBlocks) {
  const bySeed = new Map();
  const byLane = new Map();

  currentBlocks
    .filter(block => !!block.laneId)
    .sort((a, b) => a.order - b.order)
    .forEach(block => {
      if (!byLane.has(block.laneId)) byLane.set(block.laneId, 0);
      if (bySeed.has(block.originSeedRef)) return;

      const idx = byLane.get(block.laneId);
      byLane.set(block.laneId, idx + 1);
      bySeed.set(block.originSeedRef, {
        laneId: block.laneId,
        order: idx
      });
    });

  const out = {};
  bySeed.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function normalizeBlockOrders(inputBlocks) {
  const byLane = new Map();
  inputBlocks.forEach(block => {
    const key = block.laneId || "__pool";
    if (!byLane.has(key)) byLane.set(key, []);
    byLane.get(key).push(block);
  });

  const out = [];
  byLane.forEach(items => {
    items
      .sort((a, b) => a.order - b.order)
      .forEach((item, idx) => {
        item.order = idx;
        out.push(item);
      });
  });

  return out;
}

function render() {
  syncFrameState();
  renderSummary();
  renderGroups();
  renderSelectionControls();
  renderBlockModal();
}

function setMultiSelectMode(next) {
  multiSelectMode = !!next;
  renderSelectionControls();
}

function renderSelectionControls() {
  const modeBtn = document.getElementById("multi-select-mode-btn");
  const clearBtn = document.getElementById("clear-selection-btn");
  const openBtn = document.getElementById("open-selection-modal-btn");
  const saveBtn = document.getElementById("save-btn");
  const reloadBtn = document.getElementById("reload-btn");
  const viewButtons = Array.from(document.querySelectorAll("button[data-view]"));
  const isOverview = currentMode === "overview";

  viewButtons.forEach(btn => {
    const view = String(btn.dataset.view || "all").trim();
    const active = view === "all"
      ? currentMode === "overview"
      : view === currentZone && currentMode !== "overview";
    btn.classList.toggle("is-active", active);
  });

  if (modeBtn) {
    modeBtn.textContent = `複数選択: ${multiSelectMode ? "ON" : "OFF"}`;
    modeBtn.setAttribute("aria-pressed", multiSelectMode ? "true" : "false");
    modeBtn.classList.toggle("is-active", multiSelectMode);
    modeBtn.hidden = isOverview;
  }

  if (clearBtn) {
    clearBtn.disabled = isOverview || selectedBlockIds.size === 0;
    clearBtn.hidden = isOverview;
  }

  if (openBtn) {
    openBtn.disabled = isOverview || selectedBlockIds.size === 0;
    openBtn.hidden = isOverview;
  }

  if (saveBtn) {
    saveBtn.hidden = isOverview;
  }

  if (reloadBtn) {
    reloadBtn.disabled = false;
  }
}

function renderSummary() {
  const total = lots.length;
  const active = lots.filter(v => v.availableTrays > 0).length;
  const assignedSeedRefs = new Set(blocks.filter(block => !!block.laneId).map(block => block.originSeedRef));
  const label = getCurrentLocationLabel();

  const line = document.getElementById("summary-line");
  if (line) {
    line.textContent = `画面: ${label} / ロット ${total}件 / 在庫あり ${active}件 / 配置済み ${assignedSeedRefs.size}件 / 選択 ${selectedBlockIds.size}件 / 複数選択 ${multiSelectMode ? "ON" : "OFF"}`;
  }

  const staleSeedRefs = [...assignedSeedRefs].filter(seedRef => {
    const lot = lotsBySeedRef.get(seedRef);
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

function renderGroups() {
  const root = document.getElementById("zones-root");
  if (!root) return;

  root.innerHTML = "";
  if (focusedLaneId && !findLane(focusedLaneId)) focusedLaneId = "";
  root.classList.toggle("has-focused-lane", currentMode !== "lane" && !!focusedLaneId);

  if (currentMode === "overview") {
    renderOverviewMode(root);
    return;
  }

  if (currentMode === "zone") {
    renderZoneMode(root);
    if (dragPreview) renderDragPreview();
    return;
  }

  if (currentMode === "lane") {
    renderLaneMode(root);
    if (dragPreview) renderDragPreview();
    return;
  }
}

function parseViewFromLocation() {
  const params = new URLSearchParams(location.search || "");
  const fromView = String(params.get("view") || "").trim().toLowerCase();
  const fromEmptyKey = String(params.get("") || "").trim().toLowerCase();
  const value = fromView || fromEmptyKey;
  return VIEW_CONFIG[value] ? value : "all";
}

function parseRouteFromLocation() {
  const params = new URLSearchParams(location.search || "");
  const rawMode = String(params.get("mode") || "").trim().toLowerCase();
  const rawZone = String(params.get("zone") || "").trim().toLowerCase();
  const rawLaneId = String(params.get("lane") || "").trim();
  const legacyView = parseViewFromLocation();

  let laneId = rawLaneId;
  let zone = normalizeZoneId(rawZone || (legacyView !== "all" ? legacyView : ""));
  if (laneId && !findLane(laneId)) laneId = "";
  if (laneId) zone = getZoneByLaneId(laneId) || zone;

  let mode = rawMode;
  if (!mode) {
    if (laneId) mode = "lane";
    else if (zone) mode = "zone";
    else mode = "overview";
  }

  if (!["overview", "zone", "lane"].includes(mode)) mode = zone ? "zone" : "overview";
  if (mode === "lane" && !laneId) mode = zone ? "zone" : "overview";
  if (mode === "zone" && !zone) mode = "overview";

  return {
    mode,
    zone,
    laneId,
    view: mode === "overview" ? "all" : (zone || "all")
  };
}

function applyRouteState(route = {}) {
  currentMode = route.mode || "overview";
  currentZone = route.zone || "";
  currentLaneId = route.laneId || "";
  currentView = route.view || (currentMode === "overview" ? "all" : (currentZone || "all"));
  document.body.setAttribute("data-house-mode", currentMode);
  document.body.setAttribute("data-house-view", currentView);
  document.body.setAttribute("data-house-zone", currentZone || "all");
}

function navigateToRoute(nextRoute = {}, options = {}) {
  if (lockedView && nextRoute.mode !== "lane") return;

  const route = normalizeRouteState({
    mode: nextRoute.mode ?? currentMode,
    zone: nextRoute.zone ?? currentZone,
    laneId: nextRoute.laneId ?? currentLaneId
  });

  const { syncUrl = false } = options;
  const isSameRoute = route.mode === currentMode
    && route.zone === currentZone
    && route.laneId === currentLaneId;
  if (isSameRoute && !syncUrl) return;

  applyRouteState(route);
  focusedLaneId = route.mode === "lane" ? route.laneId : "";
  selectedBlockIds.clear();
  clearDragPreview();
  closeBlockModal();

  if (syncUrl) {
    const params = new URLSearchParams();
    if (route.mode !== "overview") params.set("mode", route.mode);
    if (route.mode === "zone" && route.zone) params.set("zone", route.zone);
    if (route.mode === "lane" && route.laneId) params.set("lane", route.laneId);
    const q = params.toString();
    const nextUrl = `${location.pathname}${q ? `?${q}` : ""}`;
    history.replaceState(null, "", nextUrl);
  }

  render();
}

function normalizeRouteState(route = {}) {
  let mode = String(route.mode || "overview").trim().toLowerCase();
  let zone = normalizeZoneId(route.zone);
  let laneId = String(route.laneId || "").trim();

  if (laneId && !findLane(laneId)) laneId = "";
  if (laneId) zone = getZoneByLaneId(laneId) || zone;

  if (!["overview", "zone", "lane"].includes(mode)) mode = "overview";
  if (mode === "lane" && !laneId) mode = zone ? "zone" : "overview";
  if (mode === "zone" && !zone) mode = "overview";
  if (mode === "overview") {
    zone = "";
    laneId = "";
  }

  return {
    mode,
    zone,
    laneId,
    view: mode === "overview" ? "all" : (zone || "all")
  };
}

function setCurrentView(view, options = {}) {
  if (view === "all") {
    navigateToRoute({ mode: "overview", zone: "", laneId: "" }, options);
    return;
  }
  navigateToRoute({ mode: "zone", zone: view, laneId: "" }, options);
}

function renderOverviewMode(root) {
  const wrap = document.createElement("section");
  wrap.className = "overview-grid";

  getVisibleGroups().forEach(group => {
    wrap.appendChild(buildOverviewCard(group));
  });

  const infoCard = document.createElement("section");
  infoCard.className = "overview-info-card";
  const unassignedCount = blocks.filter(block => !block.laneId && block.trays > 0).length;
  const staleCount = blocks.filter(block => {
    if (!block.laneId) return false;
    const lot = lotsBySeedRef.get(block.originSeedRef);
    return !!lot && lot.availableTrays <= 0;
  }).length;
  infoCard.innerHTML = `
    <h3 class="zone-title">全体メモ</h3>
    <div class="overview-info-line">未配置ロット: ${formatNum(unassignedCount)}件</div>
    <div class="overview-info-line">在庫0配置: ${formatNum(staleCount)}件</div>
    <div class="overview-info-line">棟を開くと移動・保存ができます</div>
  `;
  wrap.appendChild(infoCard);

  root.appendChild(wrap);
}

function renderZoneMode(root) {
  const group = getVisibleGroups()[0] || null;
  if (!group) {
    renderOverviewMode(root);
    return;
  }

  const workspace = document.createElement("section");
  workspace.className = "zone-workspace";

  workspace.appendChild(buildZoneHeroCard(group));

  const content = document.createElement("section");
  content.className = "zone-content";

  const boardPanel = document.createElement("section");
  boardPanel.className = "zone-board-panel";
  appendZoneBoard(boardPanel, group);
  content.appendChild(boardPanel);

  const poolPanel = buildZonePoolPanel(group);
  if (poolPanel) content.appendChild(poolPanel);

  workspace.appendChild(content);
  root.appendChild(workspace);
}

function renderLaneMode(root) {
  const lane = findLane(currentLaneId);
  if (!lane) {
    renderOverviewMode(root);
    return;
  }

  const group = findGroupByLaneId(lane.id);
  const workspace = document.createElement("section");
  workspace.className = "zone-workspace lane-workspace";

  workspace.appendChild(buildLaneHeroCard(lane, group));

  const content = document.createElement("section");
  content.className = "zone-content lane-content";

  const boardPanel = document.createElement("section");
  boardPanel.className = "zone-board-panel lane-board-panel";
  boardPanel.appendChild(buildGroupCard({
    id: `lane-${lane.id}`,
    kind: group?.kind || "house",
    title: group ? `${group.title} / ${lane.label}` : lane.label,
    lanes: [lane]
  }, {
    cardClass: "lane-single-card zone-main-card",
    showTitle: false
  }));
  content.appendChild(boardPanel);

  const poolPanel = buildLanePoolPanel(lane, group);
  if (poolPanel) content.appendChild(poolPanel);

  workspace.appendChild(content);
  root.appendChild(workspace);
}

function buildLaneHeroCard(lane, group) {
  const card = document.createElement("section");
  card.className = "zone-hero-card lane-hero-card";

  const usedTrays = getLaneUsedTrays(lane.id);
  const capacity = toNumber(lane.capacity);
  const freeTrays = Math.max(0, roundTray(capacity - usedTrays));
  const laneBlocks = getLaneBlocks(lane.id);
  const staleCount = laneBlocks.filter(block => {
    const lot = lotsBySeedRef.get(block.originSeedRef);
    return !!lot && lot.availableTrays <= 0;
  }).length;
  const unassignedBlocks = blocks.filter(block => !block.laneId && block.trays > 0);
  const unassignedTrays = unassignedBlocks.reduce((sum, block) => sum + block.trays, 0);

  const top = document.createElement("div");
  top.className = "zone-hero-top";

  const titleWrap = document.createElement("div");
  titleWrap.className = "zone-hero-title-wrap";
  titleWrap.innerHTML = `
    <div class="zone-hero-label">LANE WORKSPACE</div>
    <h2 class="zone-hero-title">${escapeHtml(group?.title || "")} ${escapeHtml(lane.label)}</h2>
    <div class="zone-hero-subtitle">このレーンの集中編集画面です。下段の未配置ロット帯から、このレーンへそのまま追加配置できます。</div>
  `;

  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.className = "secondary-btn zone-back-btn";
  backBtn.textContent = `${VIEW_CONFIG[getZoneByLaneId(lane.id)]?.label || "棟"}へ戻る`;
  backBtn.addEventListener("click", () => {
    navigateToRoute({ mode: "zone", zone: getZoneByLaneId(lane.id), laneId: "" }, { syncUrl: true });
  });

  top.appendChild(titleWrap);
  top.appendChild(backBtn);
  card.appendChild(top);

  const metrics = document.createElement("div");
  metrics.className = "zone-metrics lane-metrics";
  metrics.appendChild(buildZoneMetricCard("使用枚数", `${formatNum(usedTrays)} / ${formatNum(capacity)}枚`));
  metrics.appendChild(buildZoneMetricCard("空き枚数", `${formatNum(freeTrays)}枚`));
  metrics.appendChild(buildZoneMetricCard("配置ブロック", `${formatNum(laneBlocks.length)}件`));
  metrics.appendChild(buildZoneMetricCard("未配置ロット", `${formatNum(unassignedBlocks.length)}件 / ${formatNum(unassignedTrays)}枚`));
  metrics.appendChild(buildZoneMetricCard("注意", staleCount ? `在庫0配置 ${formatNum(staleCount)}件` : "問題なし"));
  card.appendChild(metrics);

  return card;
}

function buildLanePoolPanel(lane, group) {
  const panel = buildZonePoolPanel(group || { title: lane.label, id: "" }, {
    title: "未配置ロット",
    note: `${lane.label}へ入れる候補。zone と同じく下段からドラッグして配置します。`
  });
  panel.classList.add("lane-pool-panel");
  return panel;
}

function buildOverviewCard(group) {
  const card = document.createElement("section");
  card.className = "overview-zone-card";

  const assignedBlocks = blocks.filter(block => block.laneId && group.lanes.some(lane => lane.id === block.laneId));
  const used = assignedBlocks.reduce((sum, block) => sum + block.trays, 0);
  const capacity = group.lanes.reduce((sum, lane) => sum + toNumber(lane.capacity), 0);
  const percent = capacity > 0 ? Math.round((used / capacity) * 100) : 0;
  const actionZone = group.id === "east-house"
    ? "east"
    : group.id === "west-house"
      ? "west"
      : "outside";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "secondary-btn overview-open-btn";
  btn.textContent = `${VIEW_CONFIG[actionZone]?.label || group.title}を開く`;
  btn.addEventListener("click", () => {
    navigateToRoute({ mode: "zone", zone: actionZone, laneId: "" }, { syncUrl: true });
  });

  card.innerHTML = `
    <h3 class="zone-title">${escapeHtml(group.title)}</h3>
    <div class="overview-metric">使用 ${formatNum(used)} / ${formatNum(capacity)}枚</div>
    <div class="overview-metric">使用率 ${formatNum(percent)}%</div>
    <div class="overview-metric">レーン ${formatNum(group.lanes.length)}本</div>
  `;
  card.appendChild(btn);
  return card;
}

function buildZoneHeroCard(group) {
  const card = document.createElement("section");
  card.className = "zone-hero-card";

  const lanes = group.lanes || [];
  const laneIds = new Set(lanes.map(lane => lane.id));
  const assignedBlocks = blocks.filter(block => laneIds.has(block.laneId));
  const usedTrays = assignedBlocks.reduce((sum, block) => sum + block.trays, 0);
  const capacity = lanes.reduce((sum, lane) => sum + toNumber(lane.capacity), 0);
  const staleCount = assignedBlocks.filter(block => {
    const lot = lotsBySeedRef.get(block.originSeedRef);
    return !!lot && lot.availableTrays <= 0;
  }).length;
  const unassignedBlocks = blocks.filter(block => !block.laneId && block.trays > 0);
  const unassignedTrays = unassignedBlocks.reduce((sum, block) => sum + block.trays, 0);

  const top = document.createElement("div");
  top.className = "zone-hero-top";

  const titleWrap = document.createElement("div");
  titleWrap.className = "zone-hero-title-wrap";
  titleWrap.innerHTML = `
    <div class="zone-hero-label">ZONE WORKSPACE</div>
    <h2 class="zone-hero-title">${escapeHtml(group.title)}</h2>
    <div class="zone-hero-subtitle">レーンをタップすると集中編集へ。ここでは棟全体の移動と保存を行います。</div>
  `;

  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.className = "secondary-btn zone-back-btn";
  backBtn.textContent = "全体俯瞰へ戻る";
  backBtn.addEventListener("click", () => {
    navigateToRoute({ mode: "overview", zone: "", laneId: "" }, { syncUrl: true });
  });

  top.appendChild(titleWrap);
  top.appendChild(backBtn);
  card.appendChild(top);

  const metrics = document.createElement("div");
  metrics.className = "zone-metrics";
  metrics.appendChild(buildZoneMetricCard("使用枚数", `${formatNum(usedTrays)} / ${formatNum(capacity)}枚`));
  metrics.appendChild(buildZoneMetricCard("使用率", `${formatNum(capacity > 0 ? Math.round((usedTrays / capacity) * 100) : 0)}%`));
  metrics.appendChild(buildZoneMetricCard("未配置ロット", `${formatNum(unassignedBlocks.length)}件 / ${formatNum(unassignedTrays)}枚`));
  metrics.appendChild(buildZoneMetricCard("注意", staleCount ? `在庫0配置 ${formatNum(staleCount)}件` : "問題なし"));
  card.appendChild(metrics);

  const shortcuts = document.createElement("div");
  shortcuts.className = "zone-lane-shortcuts";
  lanes.forEach(lane => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "secondary-btn zone-lane-shortcut-btn";
    btn.textContent = `${lane.label}へ`;
    btn.addEventListener("click", () => {
      navigateToRoute({ mode: "lane", zone: getZoneByLaneId(lane.id), laneId: lane.id }, { syncUrl: true });
    });
    shortcuts.appendChild(btn);
  });
  card.appendChild(shortcuts);

  return card;
}

function buildZoneMetricCard(label, value) {
  const card = document.createElement("section");
  card.className = "zone-metric-card";
  card.innerHTML = `
    <div class="zone-metric-label">${escapeHtml(label)}</div>
    <div class="zone-metric-value">${escapeHtml(value)}</div>
  `;
  return card;
}

function appendZoneBoard(container, group) {
  if (group.id === "outside-area") {
    const sideLanes = ["outside-4", "outside-5", "outside-3"]
      .map(id => group.lanes.find(lane => lane.id === id))
      .filter(Boolean);
    const bottomLanes = ["outside-2", "outside-1"]
      .map(id => group.lanes.find(lane => lane.id === id))
      .filter(Boolean);

    const splitWrap = document.createElement("div");
    splitWrap.className = "zone-board-split";

    if (sideLanes.length) {
      splitWrap.appendChild(buildGroupCard({
        id: "outside-side",
        kind: "outside",
        title: "",
        lanes: sideLanes
      }, {
        cardClass: "outside-side-card zone-main-card",
        laneGridClass: "layout-outside-side",
        showTitle: false
      }));
    }

    if (bottomLanes.length) {
      splitWrap.appendChild(buildGroupCard({
        id: "outside-bottom",
        kind: "outside",
        title: "",
        lanes: bottomLanes
      }, {
        cardClass: "outside-bottom-card zone-main-card",
        laneGridClass: "layout-outside-bottom",
        showTitle: false
      }));
    }

    container.appendChild(splitWrap);
    return;
  }

  container.appendChild(buildGroupCard(group, {
    cardClass: "zone-main-card",
    showTitle: false
  }));
}

function buildZonePoolPanel(group, options = {}) {
  const panel = document.createElement("aside");
  panel.className = "zone-pool-panel";
  panel.dataset.dropTarget = "pool";

  const quickPlaceBlocks = getQuickPlaceBlocks(10);
  const groupLabel = VIEW_CONFIG[getZoneByGroupId(group.id)]?.label || group.title;
  const title = String(options.title || "未配置ロット").trim() || "未配置ロット";
  const note = String(options.note || `${groupLabel}へ入れる候補。ドラッグで配置、横にスワイプで続きを表示します。`).trim();

  panel.innerHTML = `
    <div class="zone-pool-head">
      <h3 class="zone-pool-title">${escapeHtml(title)}</h3>
      <div class="zone-pool-note">${escapeHtml(note)}</div>
    </div>
  `;

  const scrollShell = document.createElement("div");
  scrollShell.className = "zone-pool-scroll-shell";
  scrollShell.dataset.dropTarget = "pool";

  const list = document.createElement("div");
  list.className = "zone-pool-list";
  list.dataset.dropTarget = "pool";

  if (!quickPlaceBlocks.length) {
    const empty = document.createElement("div");
    empty.className = "zone-pool-empty";
    empty.textContent = "未配置ロットはありません。";
    panel.appendChild(empty);
    return panel;
  }

  quickPlaceBlocks.forEach(block => {
    list.appendChild(buildBlockCard(block, null, 0, true));
  });
  scrollShell.appendChild(list);
  panel.appendChild(scrollShell);
  return panel;
}

function syncFrameState() {
  document.body.setAttribute("data-house-mode", currentMode);
  document.body.setAttribute("data-house-view", currentView);
  document.body.setAttribute("data-house-zone", currentZone || "all");

  const titleEl = document.querySelector(".page-title");
  if (titleEl) {
    titleEl.textContent = getPageTitle();
  }
}

function getPageTitle() {
  if (currentMode === "lane") {
    const lane = findLane(currentLaneId);
    const group = lane ? findGroupByLaneId(lane.id) : null;
    return lane ? `育苗ハウス・外育苗 配置ボード（${group?.title || ""} ${lane.label}）` : "育苗ハウス・外育苗 配置ボード";
  }
  if (currentMode === "zone") {
    return `育苗ハウス・外育苗 配置ボード（${getCurrentLocationLabel()}）`;
  }
  return "育苗ハウス・外育苗 配置ボード（全体俯瞰）";
}

function getCurrentLocationLabel() {
  if (currentMode === "lane") {
    const lane = findLane(currentLaneId);
    const group = lane ? findGroupByLaneId(lane.id) : null;
    return lane ? `${group?.title || ""} ${lane.label}`.trim() : "全体俯瞰";
  }
  if (currentMode === "zone") {
    return VIEW_CONFIG[currentZone]?.label || "棟別作業";
  }
  return "全体俯瞰";
}

function normalizeZoneId(value) {
  const zone = String(value || "").trim().toLowerCase();
  return ["east", "west", "outside"].includes(zone) ? zone : "";
}

function getZoneByLaneId(laneId) {
  const group = findGroupByLaneId(laneId);
  if (!group) return "";
  if (group.id === "east-house") return "east";
  if (group.id === "west-house") return "west";
  if (group.id === "outside-area") return "outside";
  return "";
}

function getZoneByGroupId(groupId) {
  if (groupId === "east-house") return "east";
  if (groupId === "west-house") return "west";
  if (groupId === "outside-area") return "outside";
  return "";
}

function findGroupByLaneId(laneId) {
  return GROUPS.find(group => group.lanes.some(lane => lane.id === laneId)) || null;
}

function getVisibleGroups() {
  const ids = VIEW_CONFIG[currentView]?.groupIds || VIEW_CONFIG.all.groupIds;
  return GROUPS.filter(group => ids.includes(group.id));
}

function buildGroupCard(group, options = {}) {
  const {
    cardClass = "",
    laneGridClass = "",
    showTitle = true,
    showQuickPlace = false,
    quickPlaceBlocks = [],
    quickPlaceAboveTitle = false
  } = options;

  const groupClass = `group-${String(group.id || "").replace(/[^a-z0-9_-]/gi, "-")}`;

  const card = document.createElement("section");
  card.className = `zone-card group-card kind-${group.kind} ${groupClass} ${cardClass}`.trim();

  const quickPanel = (showQuickPlace && quickPlaceBlocks.length)
    ? buildQuickPlacePanel(quickPlaceBlocks)
    : null;

  if (quickPanel && quickPlaceAboveTitle) {
    card.appendChild(quickPanel);
  }

  if (showTitle && group.title) {
    const title = document.createElement("h3");
    title.className = "zone-title group-title";
    title.textContent = group.title;
    card.appendChild(title);
  }

  if (quickPanel && !quickPlaceAboveTitle) {
    card.appendChild(quickPanel);
  }

  const grid = document.createElement("div");
  grid.className = `lane-grid ${laneGridClass}`.trim();
  if (!laneGridClass || laneGridClass === "layout-outside-bottom") {
    const colTemplate = group.lanes
      .map(lane => `minmax(${getLaneMinWidthPx(lane)}px, ${getLaneWidthUnits(lane)}fr)`)
      .join(" ");
    grid.style.gridTemplateColumns = colTemplate || `repeat(${group.lanes.length}, minmax(0, 1fr))`;
  }

  group.lanes.forEach(lane => {
    grid.appendChild(buildLaneElement(lane));
  });

  card.appendChild(grid);
  return card;
}

function buildQuickPlacePanel(quickPlaceBlocks) {
  const panel = document.createElement("section");
  panel.className = "west-unsorted-card";

  const head = document.createElement("div");
  head.className = "west-unsorted-title";
  head.textContent = "未整理（播種日が新しい順）";
  panel.appendChild(head);

  const list = document.createElement("div");
  list.className = "west-unsorted-list";
  quickPlaceBlocks.forEach(block => {
    list.appendChild(buildBlockCard(block, null, 0, true));
  });
  panel.appendChild(list);

  return panel;
}

function buildLaneElement(lane) {
  const laneEl = document.createElement("section");
  const laneClass = `lane-${String(lane.id || "").replace(/[^a-z0-9_-]/gi, "-")}`;
  laneEl.className = `lane ${laneClass}`;
  laneEl.dataset.laneId = lane.id;
  if (focusedLaneId && focusedLaneId === lane.id) {
    laneEl.classList.add("is-focused");
  }

  const used = getLaneUsedTrays(lane.id);
  laneEl.innerHTML = `
    <div class="lane-head">
      <div class="lane-name">${escapeHtml(lane.label)} ${lane.capacity ? `${formatNum(lane.capacity)}枚` : ""}</div>
      <div class="lane-meta">トレイ${getLaneCols(lane)}列</div>
      <div class="lane-usage">${lane.capacity ? `使用 ${formatNum(used)} / ${formatNum(lane.capacity)}` : `配置 ${formatNum(used)}枚`}</div>
    </div>
  `;

  const body = document.createElement("div");
  body.className = "lane-body drop-pool";
  body.dataset.laneId = lane.id;
  const laneBodyHeight = computeLaneBodyHeight(lane);
  body.style.height = `${laneBodyHeight}px`;

  bindBlockDrop(body, lane, laneBodyHeight, "");

  const canvas = document.createElement("div");
  canvas.className = "lane-canvas";

  const laneBlocks = getLaneBlocks(lane.id);
  if (!laneBlocks.length) {
    const empty = document.createElement("div");
    empty.className = "lane-empty";
    empty.textContent = "ここへ配置";
    canvas.appendChild(empty);
  } else {
    laneBlocks.forEach(block => {
      const span = getBlockSpanCols(block, lane);
      const widthPct = (span / getLaneCols(lane)) * 100;
      const blockHeightPx = computeBlockHeight(block.trays, lane, laneBodyHeight, span);
      const heightPct = clamp((blockHeightPx / laneBodyHeight) * 100, 4, 100);
      const maxX = Math.max(0, 1 - (widthPct / 100));
      const maxY = Math.max(0, 1 - (heightPct / 100));
      const x = normalizePosAxis(block.posX, maxX);
      const y = normalizePosAxis(block.posY, maxY);
      const leftPct = x * 100;
      const topPct = y * 100;

      const item = document.createElement("div");
      item.className = "lane-float-item";
      item.dataset.blockId = block.blockId;
      item.style.left = `${leftPct}%`;
      item.style.top = `${topPct}%`;
      item.style.width = `${widthPct}%`;
      item.style.height = `${heightPct}%`;

      bindBlockDrop(item, lane, laneBodyHeight, block.blockId);

      const card = buildBlockCard(block, lane, 0, false, false);
      card.style.height = "100%";
      item.appendChild(card);
      canvas.appendChild(item);
    });
  }

  body.appendChild(canvas);
  laneEl.appendChild(body);
  return laneEl;
}

function getLaneBlocks(laneId) {
  return blocks
    .filter(block => block.laneId === laneId)
    .sort((a, b) => a.order - b.order);
}

function getLaneUsedTrays(laneId) {
  return blocks
    .filter(block => block.laneId === laneId)
    .reduce((sum, block) => sum + block.trays, 0);
}

function getQuickPlaceBlocks(limit = 5) {
  return blocks
    .filter(block => !block.laneId && block.trays > 0)
    .sort((a, b) => {
      const lotA = lotsBySeedRef.get(a.originSeedRef);
      const lotB = lotsBySeedRef.get(b.originSeedRef);
      const cmp = (lotB?.seedDateMs || 0) - (lotA?.seedDateMs || 0);
      if (cmp !== 0) return cmp;
      return b.trays - a.trays;
    })
    .slice(0, Math.max(0, limit));
}

function buildBlockCard(block, lane = null, laneBodyHeight = 0, compact = false, autoHeight = true) {
  const lot = lotsBySeedRef.get(block.originSeedRef);
  if (!lot) {
    const fallback = document.createElement("article");
    fallback.className = "lot-card zero";
    fallback.textContent = "ロット情報なし";
    return fallback;
  }

  const card = document.createElement("article");
  card.className = "lot-card";
  card.dataset.blockId = block.blockId;

  if (selectedBlockIds.has(block.blockId)) {
    card.classList.add("is-selected");
  }
  if (block.trays <= 0) card.classList.add("zero");
  if (block.trays > 0 && block.trays < 5) card.classList.add("warn");
  if (compact) card.classList.add("unsorted-lot-card");

  if (lane && autoHeight) {
    card.style.height = `${computeBlockHeight(block.trays, lane, laneBodyHeight, getBlockSpanCols(block, lane))}px`;
  }

  card.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest(".block-resize-handle")) return;
    startPointerDrag(event, block.blockId, card);
  });

  card.innerHTML = `
    <div class="lot-name">${escapeHtml(lot.variety)}</div>
    <div class="lot-ref">播種日 ${escapeHtml(formatSeedDateLabel(lot.seedDate, block.originSeedRef))}</div>
    <div class="lot-meta">${formatBlockTrayLine(block.trays, lane ? getBlockSpanCols(block, lane) : block.spanCols)}</div>
  `;

  if (lane && !isRotatedSpanLane(lane)) {
    ["left", "right"].forEach(side => {
      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = `block-resize-handle is-${side}`;
      handle.title = side === "left" ? "左下角をドラッグして列幅を変更" : "右下角をドラッグして列幅を変更";
      handle.textContent = "";
      handle.addEventListener("pointerdown", e => startResizeBlock(e, block.blockId, lane.id, side));
      card.appendChild(handle);
    });
  }

  return card;
}

function startResizeBlock(event, blockId, laneId, side = "right") {
  event.preventDefault();
  event.stopPropagation();

  const block = blocks.find(v => v.blockId === blockId);
  const lane = findLane(laneId);
  if (!block || !lane) return;

  const laneBody = document.querySelector(`.lane-body[data-lane-id="${CSS.escape(laneId)}"]`);
  if (!(laneBody instanceof HTMLElement)) return;

  const laneCols = getLaneCols(lane);
  const colPx = Math.max(20, laneBody.clientWidth / laneCols);

  resizeState.active = true;
  resizeState.blockId = blockId;
  resizeState.laneId = laneId;
  resizeState.side = side === "left" ? "left" : "right";
  resizeState.startX = event.clientX;
  resizeState.startCols = Math.max(1, Math.min(laneCols, block.spanCols || laneCols));
  resizeState.laneCols = laneCols;
  resizeState.colPx = colPx;
  resizeState.laneBodyHeight = laneBody.clientHeight;

  window.addEventListener("pointermove", onResizeMove);
  window.addEventListener("pointerup", stopResizeBlock, { once: true });
}

function onResizeMove(event) {
  if (!resizeState.active) return;

  const block = blocks.find(v => v.blockId === resizeState.blockId);
  const lane = findLane(resizeState.laneId);
  const laneBody = document.querySelector(`.lane-body[data-lane-id="${CSS.escape(resizeState.laneId)}"]`);
  if (!block || !lane || !(laneBody instanceof HTMLElement)) return;

  const sign = resizeState.side === "left" ? -1 : 1;
  const deltaCols = Math.round(((event.clientX - resizeState.startX) / resizeState.colPx) * sign);
  const nextCols = clamp(resizeState.startCols + deltaCols, 1, resizeState.laneCols);

  if (block.spanCols === nextCols) return;

  const currentRect = getBlockRectNorm(block, lane, resizeState.laneBodyHeight || laneBody.clientHeight);
  const nextWidthNorm = clamp(nextCols / getLaneCols(lane), 0.05, 1);
  const nextMaxX = Math.max(0, 1 - nextWidthNorm);
  const preferredX = resizeState.side === "left"
    ? clamp(currentRect.right - nextWidthNorm, 0, nextMaxX)
    : currentRect.left;

  const resolved = resolvePlacementInLane({
    lane,
    laneBodyEl: laneBody,
    laneBodyHeight: resizeState.laneBodyHeight || laneBody.clientHeight,
    movingBlockId: block.blockId,
    trays: block.trays,
    spanCols: nextCols,
    preferredX,
    preferredY: currentRect.top
  });

  if (!resolved) return;

  block.spanCols = nextCols;
  block.posX = resolved.x;
  block.posY = resolved.y;
  renderGroups();
}

function stopResizeBlock() {
  window.removeEventListener("pointermove", onResizeMove);
  resizeState.active = false;
}

function startPointerDrag(event, blockId, card) {
  if (resizeState.active || pointerDragState.active) return;

  const canGroupMove = selectedBlockIds.has(blockId) && selectedBlockIds.size > 1;
  const pointerType = String(event.pointerType || "mouse").toLowerCase();
  pointerDragState.active = true;
  pointerDragState.started = false;
  pointerDragState.pointerId = event.pointerId;
  pointerDragState.pointerType = pointerType;
  pointerDragState.blockId = blockId;
  pointerDragState.blockIds = canGroupMove ? [...selectedBlockIds] : [blockId];
  pointerDragState.startX = event.clientX;
  pointerDragState.startY = event.clientY;
  pointerDragState.latestX = event.clientX;
  pointerDragState.latestY = event.clientY;
  pointerDragState.holdReady = pointerType === "mouse";
  pointerDragState.originCard = card;
  pointerDragState.hoverEl = null;
  pointerDragState.hoverLaneId = "";
  pointerDragState.hoverBeforeBlockId = "";

  if (!pointerDragState.holdReady) {
    card.classList.add("is-hold-pending");
    pointerDragState.holdTimer = window.setTimeout(() => {
      if (!pointerDragState.active || pointerDragState.pointerId !== event.pointerId) return;
      pointerDragState.holdReady = true;
      card.classList.remove("is-hold-pending");
      beginPointerDragVisual();
      updatePointerDragTarget(pointerDragState.latestX, pointerDragState.latestY);
    }, POINTER_HOLD_DELAY_MS);
  }

  card.setPointerCapture?.(event.pointerId);
  window.addEventListener("pointermove", onPointerDragMove);
  window.addEventListener("pointerup", stopPointerDrag);
  window.addEventListener("pointercancel", cancelPointerDrag);
}

function onPointerDragMove(event) {
  if (!pointerDragState.active || event.pointerId !== pointerDragState.pointerId) return;

  pointerDragState.latestX = event.clientX;
  pointerDragState.latestY = event.clientY;

  if (!pointerDragState.started) {
    const dx = event.clientX - pointerDragState.startX;
    const dy = event.clientY - pointerDragState.startY;
    const distance = Math.hypot(dx, dy);
    if (!pointerDragState.holdReady) {
      if (distance > POINTER_HOLD_CANCEL_PX) {
        cleanupPointerDrag();
      }
      return;
    }
    if (distance < POINTER_DRAG_THRESHOLD_PX) return;
    beginPointerDragVisual();
  }

  event.preventDefault();
  updatePointerDragGhost(event.clientX, event.clientY);
  updatePointerDragTarget(event.clientX, event.clientY);
  ensurePointerAutoScroll();
}

function stopPointerDrag(event) {
  if (!pointerDragState.active) return;
  if (event.pointerId !== pointerDragState.pointerId) return;

  if (pointerDragState.started) {
    event.preventDefault();
    commitPointerDrag(event.clientX, event.clientY);
    suppressClickUntil = Date.now() + 250;
  }

  cleanupPointerDrag();
}

function cancelPointerDrag() {
  if (!pointerDragState.active) return;
  cleanupPointerDrag();
}

function beginPointerDragVisual() {
  if (pointerDragState.started) return;

  pointerDragState.started = true;
  clearPointerHoldTimer();
  dragBlockIds = [...pointerDragState.blockIds];
  dragBlockId = pointerDragState.blockId;
  pointerDragState.originCard?.classList.remove("is-hold-pending");
  pointerDragState.originCard?.classList.add("is-pointer-dragging");
  document.body.classList.add("is-pointer-dragging-block");
  renderPointerDragGhost();
}

function renderPointerDragGhost() {
  removePointerDragGhost();

  const card = pointerDragState.originCard;
  if (!(card instanceof HTMLElement)) return;

  const rect = card.getBoundingClientRect();
  const ghost = document.createElement("article");
  ghost.className = `${card.className} pointer-drag-ghost`;
  ghost.innerHTML = card.innerHTML;
  ghost.querySelectorAll(".block-resize-handle").forEach(el => el.remove());
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  document.body.appendChild(ghost);
  pointerDragState.ghostEl = ghost;
  updatePointerDragGhost(pointerDragState.latestX, pointerDragState.latestY);
}

function updatePointerDragGhost(clientX, clientY) {
  const ghost = pointerDragState.ghostEl;
  if (!(ghost instanceof HTMLElement)) return;

  const offsetX = ghost.offsetWidth / 2;
  const offsetY = Math.min(ghost.offsetHeight / 2, 56);
  ghost.style.left = `${Math.round(clientX - offsetX)}px`;
  ghost.style.top = `${Math.round(clientY - offsetY)}px`;
}

function updatePointerDragTarget(clientX, clientY) {
  const target = getPointerDropTarget(clientX, clientY);
  setPointerHoverElement(target?.hoverEl || null);

  if (!target) {
    pointerDragState.hoverLaneId = "";
    pointerDragState.hoverBeforeBlockId = "";
    clearDragPreview();
    return;
  }

  if (target.type === "pool") {
    pointerDragState.hoverLaneId = "";
    pointerDragState.hoverBeforeBlockId = "";
    clearDragPreview();
    return;
  }

  pointerDragState.hoverLaneId = target.lane.id;
  pointerDragState.hoverBeforeBlockId = target.beforeBlockId || "";
  updateDragPreview(target.lane, target.laneBodyHeight, {
    clientX,
    clientY
  });
}

function ensurePointerAutoScroll() {
  if (!pointerDragState.started || pointerDragState.autoScrollRaf) return;

  const step = () => {
    pointerDragState.autoScrollRaf = 0;
    if (!pointerDragState.active || !pointerDragState.started) return;

    const scrollingEl = document.scrollingElement || document.documentElement;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const maxScrollTop = Math.max(0, scrollingEl.scrollHeight - viewportHeight);
    if (viewportHeight <= 0 || maxScrollTop <= 0) return;

    const deltaY = computePointerAutoScrollDelta(pointerDragState.latestY, viewportHeight);
    if (!deltaY) return;

    const prevTop = scrollingEl.scrollTop;
    scrollingEl.scrollTop = clamp(prevTop + deltaY, 0, maxScrollTop);
    const changed = scrollingEl.scrollTop !== prevTop;
    if (changed) {
      updatePointerDragTarget(pointerDragState.latestX, pointerDragState.latestY);
      updatePointerDragGhost(pointerDragState.latestX, pointerDragState.latestY);
    }

    if (changed || computePointerAutoScrollDelta(pointerDragState.latestY, viewportHeight)) {
      pointerDragState.autoScrollRaf = window.requestAnimationFrame(step);
    }
  };

  pointerDragState.autoScrollRaf = window.requestAnimationFrame(step);
}

function computePointerAutoScrollDelta(clientY, viewportHeight) {
  if (clientY < POINTER_AUTO_SCROLL_EDGE_PX) {
    const ratio = 1 - clamp(clientY / POINTER_AUTO_SCROLL_EDGE_PX, 0, 1);
    return -Math.max(4, Math.round(POINTER_AUTO_SCROLL_MAX_STEP_PX * ratio));
  }

  const bottomStart = viewportHeight - POINTER_AUTO_SCROLL_EDGE_PX;
  if (clientY > bottomStart) {
    const ratio = clamp((clientY - bottomStart) / POINTER_AUTO_SCROLL_EDGE_PX, 0, 1);
    return Math.max(4, Math.round(POINTER_AUTO_SCROLL_MAX_STEP_PX * ratio));
  }

  return 0;
}

function getPointerDropTarget(clientX, clientY) {
  const el = document.elementFromPoint(clientX, clientY);
  if (!(el instanceof Element)) return null;

  const poolTarget = el.closest("[data-drop-target='pool']");
  if (poolTarget instanceof HTMLElement) {
    return {
      type: "pool",
      hoverEl: poolTarget
    };
  }

  const laneBody = el.closest(".lane-body[data-lane-id]");
  if (!(laneBody instanceof HTMLElement)) return null;

  const laneId = String(laneBody.dataset.laneId || "").trim();
  const lane = findLane(laneId);
  if (!lane) return null;

  const blockItem = el.closest(".lane-float-item[data-block-id]");
  const beforeBlockId = String(blockItem?.getAttribute("data-block-id") || "").trim();

  return {
    type: "lane",
    lane,
    laneBodyHeight: laneBody.clientHeight,
    beforeBlockId,
    hoverEl: blockItem instanceof HTMLElement ? blockItem : laneBody
  };
}

function setPointerHoverElement(nextEl) {
  if (pointerDragState.hoverEl === nextEl) return;
  if (pointerDragState.hoverEl instanceof HTMLElement) {
    pointerDragState.hoverEl.classList.remove("drag-over");
  }
  pointerDragState.hoverEl = nextEl instanceof HTMLElement ? nextEl : null;
  if (pointerDragState.hoverEl) {
    pointerDragState.hoverEl.classList.add("drag-over");
  }
}

function commitPointerDrag(clientX, clientY) {
  const target = getPointerDropTarget(clientX, clientY);
  if (!target) return;
  const ids = pointerDragState.blockIds.length
    ? [...pointerDragState.blockIds]
    : (pointerDragState.blockId ? [pointerDragState.blockId] : []);
  if (!ids.length) return;

  if (target.type === "pool") {
    const moved = moveBlocksToPool(ids);
    if (moved) render();
    return;
  }

  const eventLike = { clientX, clientY };

  const moved = ids.length > 1
    ? placeBlockGroup(ids, target.lane, target.laneBodyHeight, eventLike, target.beforeBlockId, pointerDragState.blockId)
    : placeBlock(ids[0], target.lane, target.laneBodyHeight, eventLike, target.beforeBlockId);

  if (moved) render();
}

function cleanupPointerDrag() {
  window.removeEventListener("pointermove", onPointerDragMove);
  window.removeEventListener("pointerup", stopPointerDrag);
  window.removeEventListener("pointercancel", cancelPointerDrag);

  clearPointerHoldTimer();
  stopPointerAutoScroll();

  pointerDragState.originCard?.releasePointerCapture?.(pointerDragState.pointerId);
  pointerDragState.originCard?.classList.remove("is-hold-pending");
  pointerDragState.originCard?.classList.remove("is-pointer-dragging");
  document.body.classList.remove("is-pointer-dragging-block");

  removePointerDragGhost();
  setPointerHoverElement(null);
  clearDragPreview();

  dragBlockIds = [];
  dragBlockId = "";

  pointerDragState.active = false;
  pointerDragState.started = false;
  pointerDragState.pointerId = null;
  pointerDragState.pointerType = "mouse";
  pointerDragState.blockId = "";
  pointerDragState.blockIds = [];
  pointerDragState.startX = 0;
  pointerDragState.startY = 0;
  pointerDragState.latestX = 0;
  pointerDragState.latestY = 0;
  pointerDragState.holdReady = false;
  pointerDragState.holdTimer = 0;
  pointerDragState.autoScrollRaf = 0;
  pointerDragState.originCard = null;
  pointerDragState.hoverEl = null;
  pointerDragState.hoverLaneId = "";
  pointerDragState.hoverBeforeBlockId = "";
}

function clearPointerHoldTimer() {
  if (!pointerDragState.holdTimer) return;
  window.clearTimeout(pointerDragState.holdTimer);
  pointerDragState.holdTimer = 0;
}

function stopPointerAutoScroll() {
  if (!pointerDragState.autoScrollRaf) return;
  window.cancelAnimationFrame(pointerDragState.autoScrollRaf);
  pointerDragState.autoScrollRaf = 0;
}

function removePointerDragGhost() {
  const ghost = pointerDragState.ghostEl;
  if (ghost instanceof HTMLElement) ghost.remove();
  pointerDragState.ghostEl = null;
}

function bindBlockDrop(el, lane, laneBodyHeight, beforeBlockId) {
  el.addEventListener("dragover", e => {
    e.preventDefault();
    el.classList.add("drag-over");
    updateDragPreview(lane, laneBodyHeight, e);
  });

  el.addEventListener("dragleave", () => {
    el.classList.remove("drag-over");
    clearDragPreview(lane.id);
  });

  el.addEventListener("drop", e => {
    e.preventDefault();
    el.classList.remove("drag-over");
    clearDragPreview();

    const fallbackId = dragBlockId || String(e.dataTransfer?.getData("text/plain") || "").trim();
    const ids = dragBlockIds.length ? [...dragBlockIds] : (fallbackId ? [fallbackId] : []);
    if (!ids.length) return;

    const moved = ids.length > 1
      ? placeBlockGroup(ids, lane, laneBodyHeight, e, beforeBlockId, fallbackId)
      : placeBlock(ids[0], lane, laneBodyHeight, e, beforeBlockId);

    if (moved) {
      dragBlockIds = [];
      dragBlockId = "";
    }

    if (moved) render();
  });
}

function placeBlockGroup(blockIds, lane, laneBodyHeight, dropEvent, beforeBlockId = "", anchorBlockId = "") {
  const idSet = new Set(blockIds || []);
  const group = blocks
    .filter(block => idSet.has(block.blockId))
    .sort((a, b) => a.order - b.order);

  if (!group.length) return false;

  const anchor = group.find(block => block.blockId === anchorBlockId) || group[0];
  const laneBody = document.querySelector(`.lane-body[data-lane-id="${CSS.escape(lane.id)}"]`);
  if (!(laneBody instanceof HTMLElement)) return false;

  const usedWithoutGroup = blocks
    .filter(block => !idSet.has(block.blockId) && block.laneId === lane.id)
    .reduce((sum, block) => sum + block.trays, 0);
  const groupTrays = group.reduce((sum, block) => sum + block.trays, 0);

  if (toNumber(lane.capacity) > 0 && (usedWithoutGroup + groupTrays) > (toNumber(lane.capacity) + 0.1)) {
    alert(`${lane.label} は上限 ${formatNum(lane.capacity)}枚です。選択ブロックをまとめて置くと上限を超えます。`);
    return false;
  }

  const laneCols = getLaneCols(lane);
  const anchorSpan = getBlockSpanCols(anchor, lane);
  const prefer = calcDropPosition(dropEvent, laneBody, lane, laneBodyHeight, anchorSpan, anchor.trays);

  const anchorRect = getBlockRectNorm(anchor, lane, laneBodyHeight);
  const baseX = anchorRect.left;
  const baseY = anchorRect.top;

  const placedRects = [];
  const placedMap = new Map();
  const excludeIds = [...idSet];

  for (const block of group) {
    const span = getBlockSpanCols(block, lane);
    const blockRect = getBlockRectNorm(block, lane, laneBodyHeight);
    const dx = blockRect.left - baseX;
    const dy = blockRect.top - baseY;

    const prefX = block.blockId === anchor.blockId ? prefer.x : prefer.x + dx;
    const prefY = block.blockId === anchor.blockId ? prefer.y : prefer.y + dy;

    const resolved = resolvePlacementInLane({
      lane,
      laneBodyEl: laneBody,
      laneBodyHeight,
      movingBlockId: block.blockId,
      trays: block.trays,
      spanCols: span,
      preferredX: prefX,
      preferredY: prefY,
      excludeBlockIds: excludeIds,
      occupiedRects: placedRects
    });

    if (!resolved) {
      alert("選択ブロックを重ならずに配置できる空きがありません。場所を変えてください。");
      return false;
    }

    placedMap.set(block.blockId, {
      laneId: lane.id,
      spanCols: span,
      posX: resolved.x,
      posY: resolved.y
    });

    placedRects.push(getRectNormFromPlacement({
      lane,
      laneBodyHeight,
      trays: block.trays,
      spanCols: span,
      x: resolved.x,
      y: resolved.y
    }));
  }

  group.forEach(block => {
    const next = placedMap.get(block.blockId);
    if (!next) return;
    block.laneId = next.laneId;
    block.spanCols = next.spanCols;
    block.posX = next.posX;
    block.posY = next.posY;
  });

  const sameLane = blocks
    .filter(block => !idSet.has(block.blockId) && block.laneId === lane.id)
    .sort((a, b) => a.order - b.order);

  const movedList = group.filter(block => placedMap.has(block.blockId));
  const next = [];
  let inserted = false;
  sameLane.forEach(block => {
    if (!inserted && beforeBlockId && block.blockId === beforeBlockId) {
      movedList.forEach(v => next.push(v));
      inserted = true;
    }
    next.push(block);
  });
  if (!inserted) movedList.forEach(v => next.push(v));

  next.forEach((block, idx) => {
    block.order = idx;
  });

  blocks = normalizeBlockOrders(blocks);
  return true;
}

function placeBlock(blockId, lane, laneBodyHeight, dropEvent, beforeBlockId = "") {
  const target = blocks.find(block => block.blockId === blockId);
  if (!target || !lane) return false;

  const laneBody = document.querySelector(`.lane-body[data-lane-id="${CSS.escape(lane.id)}"]`);
  if (!(laneBody instanceof HTMLElement)) return false;

  const laneCols = getLaneCols(lane);
  const spanCols = getBlockSpanCols(target, lane);

  const usedWithoutTarget = blocks
    .filter(block => block.blockId !== target.blockId && block.laneId === lane.id)
    .reduce((sum, block) => sum + block.trays, 0);

  if (toNumber(lane.capacity) > 0 && (usedWithoutTarget + target.trays) > (toNumber(lane.capacity) + 0.1)) {
    alert(`${lane.label} は上限 ${formatNum(lane.capacity)}枚です。現在の配置ではこれ以上置けません。`);
    return false;
  }

  const prefer = calcDropPosition(dropEvent, laneBody, lane, laneBodyHeight, spanCols, target.trays);
  const resolved = resolvePlacementInLane({
    lane,
    laneBodyEl: laneBody,
    laneBodyHeight,
    movingBlockId: target.blockId,
    trays: target.trays,
    spanCols,
    preferredX: prefer.x,
    preferredY: prefer.y
  });

  if (!resolved) {
    alert("その位置には置けません（重なりまたはスペース不足）。");
    return false;
  }

  target.laneId = lane.id;
  target.spanCols = spanCols;
  target.posX = resolved.x;
  target.posY = resolved.y;

  const sameLane = blocks
    .filter(block => block.blockId !== blockId && block.laneId === lane.id)
    .sort((a, b) => a.order - b.order);

  const next = [];
  let inserted = false;
  sameLane.forEach(block => {
    if (!inserted && beforeBlockId && block.blockId === beforeBlockId) {
      next.push(target);
      inserted = true;
    }
    next.push(block);
  });

  if (!inserted) next.push(target);

  next.forEach((block, idx) => {
    block.order = idx;
  });

  blocks = normalizeBlockOrders(blocks);
  return true;
}

function moveBlocksToPool(blockIds = []) {
  const ids = [...new Set((blockIds || []).filter(Boolean))];
  if (!ids.length) return false;

  const poolOrderBase = blocks
    .filter(block => !block.laneId)
    .reduce((max, block) => Math.max(max, toNumber(block.order)), -1) + 1;

  let moved = 0;
  ids.forEach((blockId, index) => {
    const target = blocks.find(block => block.blockId === blockId);
    if (!target) return;
    target.laneId = "";
    target.posX = 0;
    target.posY = 0;
    target.order = poolOrderBase + index;
    moved += 1;
  });

  if (!moved) return false;
  blocks = normalizeBlockOrders(blocks);
  return true;
}

function moveSelectedBlocksToPool() {
  const ids = selectedBlockIds.size
    ? [...selectedBlockIds]
    : (modalBlockId ? [modalBlockId] : []);
  if (!ids.length) {
    alert("先にブロックを選択してください。");
    return false;
  }

  const moved = moveBlocksToPool(ids);
  if (!moved) return false;

  modalMoveZone = "";
  modalMoveExpanded = false;
  render();
  renderBlockModal();
  return true;
}

function moveSelectedBlocksToZone(zone, laneId = "") {
  const normalizedZone = normalizeZoneId(zone);
  if (!normalizedZone) return false;

  const ids = selectedBlockIds.size
    ? [...selectedBlockIds]
    : (modalBlockId ? [modalBlockId] : []);
  if (!ids.length) {
    alert("先にブロックを選択してください。");
    return false;
  }

  const group = GROUPS.find(v => getZoneByGroupId(v.id) === normalizedZone);
  if (!group) return false;

  const targets = ids
    .map(id => blocks.find(block => block.blockId === id))
    .filter(Boolean)
    .sort((a, b) => a.order - b.order);
  if (!targets.length) return false;

  const targetLane = laneId ? findLane(laneId) : null;
  if (laneId && (!targetLane || getZoneByLaneId(laneId) !== normalizedZone)) {
    alert("移動先レーンが不正です。");
    return false;
  }

  const snapshot = targets.map(block => ({
    block,
    laneId: block.laneId,
    spanCols: block.spanCols,
    posX: block.posX,
    posY: block.posY,
    order: block.order
  }));

  for (const target of targets) {
    const placed = targetLane
      ? placeBlockInLane(target, targetLane)
      : placeBlockInZone(target, group);
    if (!placed) {
      snapshot.forEach(entry => {
        entry.block.laneId = entry.laneId;
        entry.block.spanCols = entry.spanCols;
        entry.block.posX = entry.posX;
        entry.block.posY = entry.posY;
        entry.block.order = entry.order;
      });
      blocks = normalizeBlockOrders(blocks);
      alert(targetLane
        ? `${targetLane.label} に配置できる空きがありません。`
        : `${VIEW_CONFIG[normalizedZone]?.label || normalizedZone} に配置できる空きがありません。`);
      return false;
    }
  }

  blocks = normalizeBlockOrders(blocks);
  modalMoveZone = normalizedZone;
  modalMoveExpanded = false;
  if (currentZone !== normalizedZone) {
    navigateToRoute({ mode: "zone", zone: normalizedZone, laneId: "" }, { syncUrl: true });
    return true;
  }

  render();
  renderBlockModal();
  return true;
}

function placeBlockInZone(target, group) {
  if (!target || !group) return false;

  for (const lane of group.lanes) {
    if (placeBlockInLane(target, lane)) return true;
  }

  return false;
}

function placeBlockInLane(target, lane) {
  if (!target || !lane) return false;

  const laneBodyHeight = computeLaneBodyHeight(lane);
  const laneCols = getLaneCols(lane);
  const spanCols = Math.max(1, Math.min(laneCols, Math.floor(toNumber(target.spanCols) || 1)));
  const usedWithoutTarget = blocks
    .filter(block => block.blockId !== target.blockId && block.laneId === lane.id)
    .reduce((sum, block) => sum + block.trays, 0);

  if (toNumber(lane.capacity) > 0 && (usedWithoutTarget + target.trays) > (toNumber(lane.capacity) + 0.1)) {
    return false;
  }

  const virtualLaneBody = {
    clientWidth: estimateLaneBodyWidth(lane)
  };

  const resolved = resolvePlacementInLane({
    lane,
    laneBodyEl: virtualLaneBody,
    laneBodyHeight,
    movingBlockId: target.blockId,
    trays: target.trays,
    spanCols,
    preferredX: 0,
    preferredY: 0
  });

  if (!resolved) return false;

  target.laneId = lane.id;
  target.spanCols = spanCols;
  target.posX = resolved.x;
  target.posY = resolved.y;

  const sameLane = blocks
    .filter(block => block.blockId !== target.blockId && block.laneId === lane.id)
    .sort((a, b) => a.order - b.order);
  sameLane.push(target);
  sameLane.forEach((block, idx) => {
    block.order = idx;
  });
  return true;
}

function estimateLaneBodyWidth(lane) {
  return Math.max(getLaneMinWidthPx(lane), getLaneCols(lane) * 96);
}

function calcDropPosition(dropEvent, laneBodyEl, lane, laneBodyHeight, spanCols, blockTrays) {
  const rect = laneBodyEl.getBoundingClientRect();
  const laneCols = getLaneCols(lane);
  const widthPx = Math.max(20, (Math.max(1, spanCols) / laneCols) * rect.width);
  const blockHeightPx = computeBlockHeight(blockTrays, lane, laneBodyHeight, spanCols);

  const rawX = dropEvent.clientX - rect.left - (widthPx / 2);
  const rawY = dropEvent.clientY - rect.top - (blockHeightPx / 2);

  const xDen = Math.max(1, rect.width - widthPx);
  const yDen = Math.max(1, rect.height - blockHeightPx);

  return {
    x: clamp(rawX / xDen, 0, 1),
    y: clamp(rawY / yDen, 0, 1)
  };
}

function updateDragPreview(lane, laneBodyHeight, dropEvent) {
  const laneBody = document.querySelector(`.lane-body[data-lane-id="${CSS.escape(lane.id)}"]`);
  if (!(laneBody instanceof HTMLElement)) return;

  const fallbackId = dragBlockId || "";
  const ids = dragBlockIds.length ? [...dragBlockIds] : (fallbackId ? [fallbackId] : []);
  if (!ids.length) {
    clearDragPreview();
    return;
  }

  const target = blocks.find(block => block.blockId === ids[0]);
  if (!target) {
    clearDragPreview();
    return;
  }

  const laneCols = getLaneCols(lane);
  const spanCols = Math.max(1, Math.min(laneCols, Math.floor(toNumber(target.spanCols) || 1)));
  const prefer = calcDropPosition(dropEvent, laneBody, lane, laneBodyHeight, spanCols, target.trays);
  const resolved = resolvePlacementInLane({
    lane,
    laneBodyEl: laneBody,
    laneBodyHeight,
    movingBlockId: target.blockId,
    trays: target.trays,
    spanCols,
    preferredX: prefer.x,
    preferredY: prefer.y
  });

  if (!resolved) {
    clearDragPreview();
    return;
  }

  const widthNorm = clamp(spanCols / laneCols, 0.05, 1);
  const blockHeightPx = computeBlockHeight(target.trays, lane, laneBodyHeight, spanCols);
  const heightNorm = clamp(blockHeightPx / Math.max(1, laneBodyHeight), 0.04, 1);

  dragPreview = {
    laneId: lane.id,
    x: resolved.x,
    y: resolved.y,
    width: widthNorm,
    height: heightNorm
  };
  renderDragPreview();
}

function clearDragPreview(laneId = "") {
  if (!dragPreview) return;
  if (laneId && dragPreview.laneId !== laneId) return;

  dragPreview = null;
  document.querySelectorAll(".drop-preview").forEach(el => el.remove());
}

function renderDragPreview() {
  document.querySelectorAll(".drop-preview").forEach(el => el.remove());
  if (!dragPreview) return;

  const laneBody = document.querySelector(`.lane-body[data-lane-id="${CSS.escape(dragPreview.laneId)}"]`);
  if (!(laneBody instanceof HTMLElement)) return;

  const canvas = laneBody.querySelector(".lane-canvas");
  if (!(canvas instanceof HTMLElement)) return;

  const preview = document.createElement("div");
  preview.className = "drop-preview";
  preview.style.left = `${(dragPreview.x * 100).toFixed(2)}%`;
  preview.style.top = `${(dragPreview.y * 100).toFixed(2)}%`;
  preview.style.width = `${(dragPreview.width * 100).toFixed(2)}%`;
  preview.style.height = `${(dragPreview.height * 100).toFixed(2)}%`;
  canvas.appendChild(preview);
}

function resolvePlacementInLane({
  lane,
  laneBodyEl,
  laneBodyHeight,
  movingBlockId,
  trays,
  spanCols,
  preferredX,
  preferredY,
  excludeBlockIds = [],
  occupiedRects = []
}) {
  const laneCols = getLaneCols(lane);
  const widthNorm = clamp(spanCols / laneCols, 0.05, 1);
  const heightPx = computeBlockHeight(trays, lane, laneBodyHeight, spanCols);
  const heightNorm = clamp(heightPx / Math.max(1, laneBodyHeight), 0.04, 1);
  const edgeGapNormX = PLACEMENT_EDGE_GAP_PX / Math.max(1, laneBodyEl.clientWidth);
  const edgeGapNormY = PLACEMENT_EDGE_GAP_PX / Math.max(1, laneBodyHeight);

  const maxX = Math.max(0, 1 - widthNorm - edgeGapNormX);
  const maxY = Math.max(0, 1 - heightNorm - edgeGapNormY);

  const stepX = clamp(SNAP_PX / Math.max(1, laneBodyEl.clientWidth), 0.01, 0.2);
  const stepY = clamp(SNAP_PX / Math.max(1, laneBodyHeight), 0.01, 0.2);

  const prefXRaw = normalizePosAxis(preferredX, maxX);
  const prefYRaw = normalizePosAxis(preferredY, maxY);
  const prefX = snapToStep(clamp(prefXRaw, 0, maxX), stepX, maxX);
  const prefY = snapToStep(clamp(prefYRaw, 0, maxY), stepY, maxY);

  const xs = buildSnapAxis(maxX, stepX);
  const ys = buildSnapAxis(maxY, stepY);

  const candidates = [];
  ys.forEach(y => {
    xs.forEach(x => {
      const dx = x - prefX;
      const dy = y - prefY;
      candidates.push({ x, y, d: (dx * dx) + (dy * dy) });
    });
  });
  candidates.sort((a, b) => a.d - b.d);

  const excludeSet = new Set(excludeBlockIds || []);
  const others = blocks
    .filter(block => block.blockId !== movingBlockId && block.laneId === lane.id && !excludeSet.has(block.blockId))
    .map(block => getBlockRectNorm(block, lane, laneBodyHeight));
  const fixedOccupied = (occupiedRects || []).filter(Boolean);

  for (const c of candidates) {
    const rect = {
      left: c.x,
      top: c.y,
      right: c.x + widthNorm,
      bottom: c.y + heightNorm
    };

    const overlapped = others.some(other => isRectOverlap(rect, other))
      || fixedOccupied.some(other => isRectOverlap(rect, other));
    if (!overlapped) {
      return { x: c.x, y: c.y };
    }
  }

  return null;
}

function getBlockRectNorm(block, lane, laneBodyHeight) {
  const laneCols = getLaneCols(lane);
  const span = getBlockSpanCols(block, lane);
  const width = clamp(span / laneCols, 0.05, 1);
  const heightPx = computeBlockHeight(block.trays, lane, laneBodyHeight, span);
  const height = clamp(heightPx / Math.max(1, laneBodyHeight), 0.04, 1);

  const maxX = Math.max(0, 1 - width);
  const maxY = Math.max(0, 1 - height);
  const x = normalizePosAxis(block.posX, maxX);
  const y = normalizePosAxis(block.posY, maxY);

  return {
    left: x,
    top: y,
    right: x + width,
    bottom: y + height
  };
}

function getRectNormFromPlacement({ lane, laneBodyHeight, trays, spanCols, x, y }) {
  const laneCols = getLaneCols(lane);
  const span = getEffectiveSpanCols(lane, spanCols);
  const width = clamp(span / laneCols, 0.05, 1);
  const heightPx = computeBlockHeight(trays, lane, laneBodyHeight, span);
  const height = clamp(heightPx / Math.max(1, laneBodyHeight), 0.04, 1);

  const maxX = Math.max(0, 1 - width);
  const maxY = Math.max(0, 1 - height);
  const left = clamp(toNumber(x), 0, maxX);
  const top = clamp(toNumber(y), 0, maxY);

  return {
    left,
    top,
    right: left + width,
    bottom: top + height
  };
}

function normalizePosAxis(value, maxAxis) {
  const max = Math.max(0, toNumber(maxAxis));
  if (max <= 0) return 0;

  const n = clamp(toNumber(value), 0, 1);
  // Backward compatibility: older data can have 0..1 ratio of available track.
  if (n > (max + 0.0005)) {
    return clamp(n * max, 0, max);
  }
  return clamp(n, 0, max);
}

function isRectOverlap(a, b) {
  const eps = 0.002;
  return !(a.right <= (b.left + eps)
    || b.right <= (a.left + eps)
    || a.bottom <= (b.top + eps)
    || b.bottom <= (a.top + eps));
}

function buildSnapAxis(max, step) {
  const out = [0];
  let cur = step;
  while (cur < max) {
    out.push(Number(cur.toFixed(4)));
    cur += step;
  }
  if (max > 0) out.push(Number(max.toFixed(4)));
  return [...new Set(out)].sort((a, b) => a - b);
}

function snapToStep(value, step, max) {
  if (step <= 0) return clamp(value, 0, max);
  const snapped = Math.round(value / step) * step;
  return clamp(Number(snapped.toFixed(4)), 0, max);
}

function toggleSelection(blockId, multiSelect) {
  if (!multiSelect) {
    selectedBlockIds.clear();
    selectedBlockIds.add(blockId);
    return;
  }

  if (selectedBlockIds.has(blockId)) selectedBlockIds.delete(blockId);
  else selectedBlockIds.add(blockId);
}

function splitSelectedBlock() {
  if (selectedBlockIds.size !== 1) {
    alert("分割するブロックを1つ選択してください。");
    return;
  }

  const blockId = [...selectedBlockIds][0];
  const target = blocks.find(block => block.blockId === blockId);
  if (!target) return;

  if (target.trays <= 1) {
    alert("分割できる枚数がありません。");
    return;
  }

  const defaultValue = String(Math.max(1, Math.floor(target.trays / 2)));
  const input = window.prompt("分割後の1つ目の枚数を入力してください。", defaultValue);
  if (input == null) return;

  const first = roundTray(toNumber(input));
  if (first <= 0 || first >= target.trays) {
    alert("入力値が不正です。0より大きく、元の枚数未満で入力してください。");
    return;
  }

  const rest = roundTray(target.trays - first);
  target.trays = first;

  const sibling = {
    blockId: newBlockId(target.originSeedRef),
    originSeedRef: target.originSeedRef,
    trays: rest,
    laneId: target.laneId,
    spanCols: target.spanCols,
    posX: clamp(toNumber(target.posX) + 0.04, 0, 1),
    posY: clamp(toNumber(target.posY) + 0.02, 0, 1),
    order: target.order + 0.5
  };

  blocks.push(sibling);
  blocks = normalizeBlockOrders(blocks);

  selectedBlockIds.clear();
  selectedBlockIds.add(target.blockId);
  render();
}

function mergeSelectedBlocks() {
  if (selectedBlockIds.size < 2) {
    alert("結合するブロックを2つ以上選択してください。複数選択モードをONにしてタップ選択できます。PCではCtrl/Command+クリックも使えます。");
    return;
  }

  const targets = blocks
    .filter(block => selectedBlockIds.has(block.blockId))
    .sort((a, b) => a.order - b.order);

  if (targets.length < 2) {
    alert("結合対象が見つかりませんでした。");
    return;
  }

  const first = targets[0];
  const sameOrigin = targets.every(block => block.originSeedRef === first.originSeedRef);
  const sameLane = targets.every(block => block.laneId === first.laneId);

  if (!sameOrigin || !sameLane) {
    alert("結合は同一ロット・同一レーンのブロックのみ可能です。");
    return;
  }

  const merged = roundTray(targets.reduce((sum, block) => sum + block.trays, 0));
  first.trays = merged;

  const dropIds = new Set(targets.slice(1).map(block => block.blockId));
  blocks = blocks.filter(block => !dropIds.has(block.blockId));
  blocks = normalizeBlockOrders(blocks);

  selectedBlockIds.clear();
  selectedBlockIds.add(first.blockId);
  modalBlockId = first.blockId;
  render();
}

function openBlockModal(blockId = "") {
  const modal = document.getElementById("block-modal");
  if (!modal) return;

  if (blockId) {
    modalBlockId = blockId;
  }

  const activeBlock = blocks.find(v => v.blockId === (blockId || modalBlockId)) || null;
  modalMoveZone = "";
  modalMoveExpanded = false;

  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  renderBlockModal();
}

function closeBlockModal() {
  const modal = document.getElementById("block-modal");
  if (!modal) return;

  modal.classList.remove("is-open");
  modal.setAttribute("aria-hidden", "true");
  modalMoveZone = "";
  modalMoveExpanded = false;
}

function renderBlockModal() {
  const modal = document.getElementById("block-modal");
  const detailEl = document.getElementById("block-modal-detail");
  const selectionEl = document.getElementById("block-modal-selection");
  const moveEl = document.getElementById("block-modal-move");
  const discardSeedBtn = document.getElementById("modal-discard-seed-btn");
  const splitBtn = document.getElementById("modal-split-btn");
  const mergeBtn = document.getElementById("modal-merge-btn");
  if (!modal || !detailEl || !selectionEl || !moveEl || !discardSeedBtn || !splitBtn || !mergeBtn) return;
  if (!modal.classList.contains("is-open")) return;

  let block = blocks.find(v => v.blockId === modalBlockId) || null;
  if (!block && selectedBlockIds.size) {
    const firstId = [...selectedBlockIds][0];
    block = blocks.find(v => v.blockId === firstId) || null;
  }
  if (!block) {
    closeBlockModal();
    return;
  }

  modalBlockId = block.blockId;
  const lot = lotsBySeedRef.get(block.originSeedRef);
  const lane = findLane(block.laneId);
  const selected = blocks.filter(v => selectedBlockIds.has(v.blockId));

  detailEl.innerHTML = `
    <div><strong>ロットID:</strong> ${escapeHtml(block.originSeedRef)}</div>
    <div><strong>播種日:</strong> ${escapeHtml(formatSeedDateLabel(lot?.seedDate, block.originSeedRef))}</div>
    <div><strong>品種:</strong> ${escapeHtml(lot?.variety || "(不明)")}</div>
    <div><strong>現在枚数:</strong> ${formatNum(block.trays)} 枚</div>
    <div><strong>配置先:</strong> ${escapeHtml(lane?.label || "未配置")}</div>
  `;

  const mergeReady = canMergeSelection(selected);
  const splitReady = selectedBlockIds.size === 1 && block.trays > 1;
  const selectedCount = selectedBlockIds.size;
  const modeText = multiSelectMode ? "ON" : "OFF";
  const currentBlockZone = lane ? getZoneByLaneId(lane.id) : "";

  selectionEl.innerHTML = mergeReady
    ? `選択中 ${selectedCount} 件 / 複数選択 ${modeText}: 同一ロットID・同一レーンなので結合できます。`
    : `選択中 ${selectedCount} 件 / 複数選択 ${modeText}: 別ロットIDでも同時移動は可能です。結合は同一ロットIDかつ同一レーンのみです。`;

  moveEl.innerHTML = buildMovePickerMarkup(currentBlockZone, !!block.laneId);
  discardSeedBtn.disabled = !block.originSeedRef;
  splitBtn.disabled = !splitReady;
  mergeBtn.disabled = !mergeReady;
}

function buildMovePickerMarkup(currentBlockZone, canReturnPool) {
  const zones = ["east", "west", "outside"];
  const selectedZone = normalizeZoneId(modalMoveZone);
  const laneButtons = selectedZone
    ? getLanesForZone(selectedZone).map(lane => `
      <button class="secondary-btn move-lane-btn" type="button" data-move-zone="${selectedZone}" data-move-lane-id="${escapeHtml(lane.id)}">${escapeHtml(lane.label)}</button>
    `).join("")
    : "";

  return `
    <section class="block-modal__move-section">
      <button class="block-modal__move-toggle" type="button" data-move-toggle="true" aria-expanded="${modalMoveExpanded ? "true" : "false"}">
        <span class="block-modal__move-title">移動先を選択</span>
        <span class="block-modal__move-toggle-icon">${modalMoveExpanded ? "−" : "+"}</span>
      </button>
      ${modalMoveExpanded ? `
        <div class="block-modal__move-categories">
          <button class="secondary-btn" type="button" data-move-category="pool" ${canReturnPool ? "" : "disabled"}>未配置へ戻す</button>
          ${zones.map(zone => `
            <button class="secondary-btn ${selectedZone === zone ? "is-active" : ""}" type="button" data-move-category="${zone}" ${currentBlockZone === zone ? "disabled" : ""}>${escapeHtml(VIEW_CONFIG[zone]?.label || zone)}</button>
          `).join("")}
        </div>
        ${selectedZone ? `
          <div class="block-modal__move-step">${escapeHtml(VIEW_CONFIG[selectedZone]?.label || selectedZone)} へ移動</div>
          <div class="block-modal__move-actions">
            <button class="secondary-btn" type="button" data-move-auto-zone="${selectedZone}">自動配置</button>
            ${laneButtons}
          </div>
        ` : ""}
      ` : ""}
    </section>
  `;
}

function getLanesForZone(zone) {
  const group = GROUPS.find(v => getZoneByGroupId(v.id) === normalizeZoneId(zone));
  return group?.lanes || [];
}

function canMergeSelection(selected) {
  if (!Array.isArray(selected) || selected.length < 2) return false;
  const first = selected[0];
  return selected.every(block => block.originSeedRef === first.originSeedRef && block.laneId === first.laneId);
}

function findLane(laneId) {
  return allLanes().find(v => v.id === laneId) || null;
}

function allLanes() {
  return GROUPS.flatMap(group => group.lanes);
}

function getLaneCols(lane) {
  return Math.max(1, Math.floor(toNumber(lane?.trayCols) || 3));
}

function isRotatedSpanLane(lane) {
  return String(lane?.shortEdgeAxis || "").toLowerCase() === "ns";
}

function getEffectiveSpanCols(lane, rawSpan) {
  const laneCols = getLaneCols(lane);
  if (isRotatedSpanLane(lane)) return laneCols;
  return Math.max(1, Math.min(laneCols, Math.floor(toNumber(rawSpan) || 1)));
}

function getBlockSpanCols(block, lane) {
  return getEffectiveSpanCols(lane, block?.spanCols);
}

function getLaneRows(lane) {
  const cols = getLaneCols(lane);
  const capacity = toNumber(lane?.capacity);
  if (capacity <= 0) return 24;
  return Math.max(1, capacity / cols);
}

function isOutsideBottomLane(lane) {
  const id = String(lane?.id || "");
  return id === "outside-1" || id === "outside-2";
}

function getTraySizeByLane(lane) {
  const axis = String(lane?.shortEdgeAxis || "ew").toLowerCase();
  if (axis === "ns") {
    return {
      ewMm: TRAY_LENGTH_MM,
      nsMm: TRAY_WIDTH_MM
    };
  }
  return {
    ewMm: TRAY_WIDTH_MM,
    nsMm: TRAY_LENGTH_MM
  };
}

function getLaneWidthUnits(lane) {
  if (isOutsideBottomLane(lane)) {
    const tray = getTraySizeByLane(lane);
    const longEdgeRows = getLaneRows(lane);
    return Math.max(1, longEdgeRows * tray.ewMm);
  }

  const cols = getLaneCols(lane);
  const tray = getTraySizeByLane(lane);
  return cols * tray.ewMm;
}

function getLaneMinWidthPx(lane) {
  const cols = getLaneCols(lane);
  const tray = getTraySizeByLane(lane);
  const shortEdgeMm = Math.min(tray.ewMm, tray.nsMm);
  const trayBased = shortEdgeMm * MM_TO_PX * LANE_COL_WIDTH_FACTOR;
  const perCol = clamp(Math.round(trayBased), 34, 56);
  return clamp((perCol * cols) + 44, 130, 250);
}

function isOutsideZoneRoute() {
  if (currentMode === "zone" && currentZone === "outside") return true;
  if (currentMode === "lane" && getZoneByLaneId(currentLaneId) === "outside") return true;
  return false;
}

function adjustOutsideLaneBodyHeight(lane, baseHeight) {
  const laneId = String(lane?.id || "").trim();
  const base = Math.max(0, Math.round(baseHeight || 0));

  if (laneId === "outside-4") {
    return clamp(Math.round(base * 0.62), 260, 420);
  }
  if (laneId === "outside-5") {
    return clamp(Math.round(base * 0.62), 240, 390);
  }
  if (laneId === "outside-3") {
    return clamp(Math.round(base * 0.82), 130, 180);
  }
  if (laneId === "outside-1" || laneId === "outside-2") {
    return clamp(Math.round(base * 0.88), 120, 190);
  }

  return base;
}

function computeLaneBodyHeight(lane) {
  let height = 0;
  if (isOutsideBottomLane(lane)) {
    const tray = getTraySizeByLane(lane);
    const shortEdgeMm = Math.min(tray.ewMm, tray.nsMm);
    const px = getLaneCols(lane) * shortEdgeMm * MM_TO_PX * 13;
    height = clamp(Math.round(px), 130, 250);
  } else {
    const rows = getLaneRows(lane);
    const tray = getTraySizeByLane(lane);
    const px = rows * tray.nsMm * MM_TO_PX * 1.16;
    height = clamp(Math.round(px), 190, 1220);
  }

  if (isOutsideZoneRoute() && getZoneByLaneId(lane?.id) === "outside") {
    return adjustOutsideLaneBodyHeight(lane, height);
  }

  return height;
}

function computeBlockHeight(blockTrays, lane, laneBodyHeight = 0, spanCols = 1) {
  const laneCapacity = toNumber(lane?.capacity);
  const trays = Math.max(0, toNumber(blockTrays));
  const laneCols = getLaneCols(lane || {});
  const cols = Math.max(1, Math.min(laneCols, Math.floor(toNumber(spanCols) || 1)));

  if (laneCapacity > 0 && laneBodyHeight > 0) {
    const ratio = trays / laneCapacity;
    const adjusted = laneBodyHeight * ratio * (laneCols / cols);
    if (trays <= 0) return 18;
    return clamp(Math.round(adjusted), 18, Math.max(24, laneBodyHeight - 6));
  }

  if (trays <= 0) return 30;
  const rows = trays / cols;
  const tray = getTraySizeByLane(lane || {});
  const px = rows * tray.nsMm * MM_TO_PX;
  return clamp(Math.round(px), 30, 220);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatNum(v) {
  return Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function formatBlockTrayLine(trays, spanCols) {
  const cols = Math.max(1, Math.floor(toNumber(spanCols) || 1));
  const total = roundTray(toNumber(trays));

  // Decimal totals are shown as an average per column.
  if (Math.abs(total - Math.round(total)) > 0.001) {
    const perCol = roundTray(total / cols);
    return `${formatNum(total)}枚（${cols}列×${formatNum(perCol)}枚）`;
  }

  const totalInt = Math.round(total);
  const base = Math.floor(totalInt / cols);
  const rem = totalInt - (base * cols);
  if (rem <= 0) {
    return `${totalInt}枚（${cols}列×${base}枚）`;
  }
  return `${totalInt}枚（${cols}列×${base}枚+${rem}枚）`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
