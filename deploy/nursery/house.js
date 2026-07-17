import { loadCSV, normalizeKeys } from "/common/csv.js";
import { loadJSON, saveJSON } from "/common/json.js";

const LAYOUT_PATH = "logs/nursery/house-layout.json";

const TRAY_WIDTH_MM = 300;
const TRAY_LENGTH_MM = 600;
const MM_TO_PX = 0.0088;

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
let laneLayouts = {};
let focusedLaneId = "";
let dragBlockId = "";
const selectedBlockIds = new Set();

export async function initNurseryHousePage() {
  bindControls();
  await reloadAll();
}

function bindControls() {
  const reloadBtn = document.getElementById("reload-btn");
  const saveBtn = document.getElementById("save-btn");
  const splitBtn = document.getElementById("split-btn");
  const mergeBtn = document.getElementById("merge-btn");
  const zonesRoot = document.getElementById("zones-root");

  reloadBtn?.addEventListener("click", async () => {
    await reloadAll();
  });

  saveBtn?.addEventListener("click", async () => {
    await saveLayout();
  });

  splitBtn?.addEventListener("click", () => {
    splitSelectedBlock();
  });

  mergeBtn?.addEventListener("click", () => {
    mergeSelectedBlocks();
  });

  if (!zonesRoot) return;

  zonesRoot.addEventListener("change", event => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    if (!target.classList.contains("lane-layout-select")) return;

    const laneId = String(target.dataset.laneId || "").trim();
    if (!laneId) return;

    laneLayouts[laneId] = { mode: String(target.value || "default") };
    reconcileBlockSlotsWithLayouts();
    renderGroups();
  });

  zonesRoot.addEventListener("click", event => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const cardEl = target.closest(".lot-card[data-block-id]");
    if (cardEl) {
      const blockId = String(cardEl.getAttribute("data-block-id") || "").trim();
      if (!blockId) return;
      toggleSelection(blockId, event.ctrlKey || event.metaKey);
      renderGroups();
      return;
    }

    if (target.closest(".lane-layout-select")) return;

    const laneHead = target.closest(".lane-head");
    if (!laneHead) return;

    const laneEl = laneHead.closest(".lane");
    const laneId = String(laneEl?.getAttribute("data-lane-id") || "").trim();
    if (!laneId) return;

    focusedLaneId = focusedLaneId === laneId ? "" : laneId;
    renderGroups();
  });
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

  lots = buildLots(seedRows, plantingRows, discardRows);
  lotsBySeedRef = new Map(lots.map(lot => [lot.seedRef, lot]));

  const normalized = normalizeLayoutModel(layout, lotsBySeedRef);
  blocks = normalized.blocks;
  laneLayouts = normalized.laneLayouts;
  selectedBlockIds.clear();

  reconcileBlockSlotsWithLayouts();
  render();
}

async function loadLayout() {
  try {
    return await loadJSON(`/${LAYOUT_PATH}`);
  } catch {
    return { version: 2, blocks: [], laneLayouts: {}, assignments: {} };
  }
}

async function saveLayout() {
  try {
    const payload = {
      version: 2,
      updatedAt: new Date().toISOString(),
      blocks,
      laneLayouts,
      assignments: deriveLegacyAssignments(blocks)
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

function roundTray(v) {
  return Math.max(0, Math.round(v * 10) / 10);
}

function newBlockId(originSeedRef) {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  return `${originSeedRef}#${suffix}`;
}

function normalizeLayoutModel(layout, lotMap) {
  const rawBlocks = Array.isArray(layout?.blocks)
    ? layout.blocks
    : legacyAssignmentsToBlocks(layout?.assignments || {}, lotMap);

  const grouped = new Map();
  rawBlocks.forEach((row, index) => {
    const originSeedRef = String(row?.originSeedRef || row?.seedRef || "").trim();
    if (!originSeedRef || !lotMap.has(originSeedRef)) return;

    const trays = roundTray(toNumber(row?.trays));
    if (trays <= 0) return;

    const laneId = String(row?.laneId || "").trim();
    const validLane = laneId && findLane(laneId) ? laneId : "";
    const slotIndex = Math.max(0, Math.floor(toNumber(row?.slotIndex)));
    const order = Number.isFinite(Number(row?.order)) ? Number(row.order) : index;

    const block = {
      blockId: String(row?.blockId || "").trim() || newBlockId(originSeedRef),
      originSeedRef,
      trays,
      laneId: validLane,
      slotIndex,
      order
    };

    if (!grouped.has(originSeedRef)) grouped.set(originSeedRef, []);
    grouped.get(originSeedRef).push(block);
  });

  const normalizedBlocks = [];
  lotMap.forEach((lot, seedRef) => {
    const available = roundTray(toNumber(lot.availableTrays));
    if (available <= 0) return;

    let list = (grouped.get(seedRef) || []).sort((a, b) => a.order - b.order);
    let sum = roundTray(list.reduce((acc, b) => acc + b.trays, 0));

    if (sum > available) {
      let excess = roundTray(sum - available);
      const shrink = [...list].sort((a, b) => {
        if ((a.laneId ? 1 : 0) !== (b.laneId ? 1 : 0)) return (a.laneId ? 1 : 0) - (b.laneId ? 1 : 0);
        return b.order - a.order;
      });

      shrink.forEach(block => {
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
        slotIndex: 0,
        order: list.length
      });
    }

    normalizedBlocks.push(...list);
  });

  const normalizedLayouts = sanitizeLaneLayouts(layout?.laneLayouts || {});
  const uniqueIds = new Set();
  normalizedBlocks.forEach((block, index) => {
    if (!block.blockId || uniqueIds.has(block.blockId)) {
      block.blockId = newBlockId(block.originSeedRef);
    }
    uniqueIds.add(block.blockId);
    if (!Number.isFinite(Number(block.order))) block.order = index;
  });

  return {
    blocks: normalizeBlockOrders(normalizedBlocks),
    laneLayouts: normalizedLayouts
  };
}

function legacyAssignmentsToBlocks(legacyAssignments, lotMap) {
  const list = [];
  lotMap.forEach((lot, seedRef) => {
    const legacy = legacyAssignments?.[seedRef];
    const laneId = String(legacy?.laneId || "").trim();
    list.push({
      blockId: newBlockId(seedRef),
      originSeedRef: seedRef,
      trays: roundTray(toNumber(lot.availableTrays)),
      laneId: laneId && findLane(laneId) ? laneId : "",
      slotIndex: 0,
      order: Number.isFinite(Number(legacy?.order)) ? Number(legacy.order) : 0
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

function sanitizeLaneLayouts(raw) {
  const next = {};
  allLanes().forEach(lane => {
    const mode = String(raw?.[lane.id]?.mode || "default").trim();
    const options = getLaneLayoutOptions(lane).map(v => v.value);
    next[lane.id] = {
      mode: options.includes(mode) ? mode : "default"
    };
  });
  return next;
}

function normalizeBlockOrders(inputBlocks) {
  const grouped = new Map();
  inputBlocks.forEach(block => {
    const key = `${block.laneId || "__pool"}|${block.slotIndex || 0}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(block);
  });

  const out = [];
  grouped.forEach(items => {
    items
      .sort((a, b) => a.order - b.order)
      .forEach((item, idx) => {
        item.order = idx;
        out.push(item);
      });
  });
  return out;
}

function reconcileBlockSlotsWithLayouts() {
  blocks.forEach(block => {
    if (!block.laneId) {
      block.slotIndex = 0;
      return;
    }

    const lane = findLane(block.laneId);
    if (!lane) {
      block.laneId = "";
      block.slotIndex = 0;
      return;
    }

    const spec = getLaneLayoutSpec(lane);
    if (!spec.activeSlots.length) {
      block.slotIndex = 0;
      return;
    }

    if (!spec.activeSlots.includes(block.slotIndex)) {
      block.slotIndex = spec.activeSlots[spec.activeSlots.length - 1];
    }
  });

  blocks = normalizeBlockOrders(blocks);
}

function render() {
  renderSummary();
  renderGroups();
}

function renderSummary() {
  const total = lots.length;
  const active = lots.filter(v => v.availableTrays > 0).length;
  const assignedSeedRefs = new Set(
    blocks.filter(block => !!block.laneId && block.trays > 0).map(block => block.originSeedRef)
  );

  const line = document.getElementById("summary-line");
  if (line) {
    line.textContent = `ロット ${total}件 / 在庫あり ${active}件 / 配置済み ${assignedSeedRefs.size}件`;
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
  if (focusedLaneId && !findLane(focusedLaneId)) {
    focusedLaneId = "";
  }
  root.classList.toggle("has-focused-lane", !!focusedLaneId);

  const quickPlaceBlocks = getQuickPlaceBlocks(5);

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
        {
          cardClass: "outside-bottom-card is-wide",
          laneGridClass: "layout-outside-bottom",
          showTitle: false
        }
      ));
    }
  }

  if (westGroup) {
    root.appendChild(buildGroupCard(westGroup, {
      showQuickPlace: true,
      quickPlaceBlocks
    }));
  }
  if (eastGroup) {
    root.appendChild(buildGroupCard(eastGroup));
  }
}

function buildGroupCard(group, options = {}) {
  const {
    cardClass = "",
    laneGridClass = "",
    showTitle = true,
    showQuickPlace = false,
    quickPlaceBlocks = []
  } = options;

  const groupClass = `group-${String(group.id || "").replace(/[^a-z0-9_-]/gi, "-")}`;
  const card = document.createElement("section");
  card.className = `zone-card group-card kind-${group.kind} ${groupClass} ${cardClass}`.trim();

  if (showTitle && group.title) {
    const title = document.createElement("h3");
    title.className = "zone-title group-title";
    title.textContent = group.title;
    card.appendChild(title);
  }

  if (showQuickPlace && quickPlaceBlocks.length) {
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
    card.appendChild(panel);
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
    grid.appendChild(buildLaneElement(lane));
  });

  card.appendChild(grid);
  return card;
}

function buildLaneElement(lane) {
  const laneEl = document.createElement("section");
  const laneClass = `lane-${String(lane.id || "").replace(/[^a-z0-9_-]/gi, "-")}`;
  laneEl.className = `lane ${laneClass}`;
  laneEl.dataset.laneId = lane.id;
  if (focusedLaneId && focusedLaneId === lane.id) {
    laneEl.classList.add("is-focused");
  }

  const layoutOptions = getLaneLayoutOptions(lane);
  const mode = getLaneLayoutMode(lane.id);
  const optionHtml = layoutOptions
    .map(opt => `<option value="${escapeHtml(opt.value)}" ${opt.value === mode ? "selected" : ""}>${escapeHtml(opt.label)}</option>`)
    .join("");

  const used = getLaneUsedTrays(lane.id);
  laneEl.innerHTML = `
    <div class="lane-head">
      <div class="lane-name">${escapeHtml(lane.label)} ${lane.capacity ? `${formatNum(lane.capacity)}枚` : ""}</div>
      <div class="lane-meta">トレイ${getLaneCols(lane)}列</div>
      <div class="lane-usage">${lane.capacity ? `使用 ${formatNum(used)} / ${formatNum(lane.capacity)}` : `配置 ${formatNum(used)}枚`}</div>
      <div class="lane-layout-line">
        <label>運用列</label>
        <select class="lane-layout-select" data-lane-id="${escapeHtml(lane.id)}">${optionHtml}</select>
      </div>
    </div>
  `;

  const body = document.createElement("div");
  body.className = "lane-body";
  const laneBodyHeight = computeLaneBodyHeight(lane);
  body.style.height = `${laneBodyHeight}px`;

  const spec = getLaneLayoutSpec(lane);
  const slots = document.createElement("div");
  slots.className = "lane-slots";
  slots.style.gridTemplateColumns = `repeat(${spec.slotCount}, minmax(0, 1fr))`;

  for (let slotIndex = 0; slotIndex < spec.slotCount; slotIndex += 1) {
    const slotEl = document.createElement("section");
    slotEl.className = "lane-slot drop-pool";
    slotEl.dataset.laneId = lane.id;
    slotEl.dataset.slotIndex = String(slotIndex);

    if (!spec.activeSlots.includes(slotIndex)) {
      slotEl.classList.add("is-inactive");
    } else {
      bindBlockDrop(slotEl, lane.id, slotIndex, "");
    }

    if (spec.groupBreakAfter.includes(slotIndex)) {
      slotEl.classList.add("group-break");
    }

    const slotBlocks = getLaneSlotBlocks(lane.id, slotIndex);
    if (!slotBlocks.length) {
      const empty = document.createElement("div");
      empty.className = "lane-empty";
      empty.textContent = spec.activeSlots.includes(slotIndex) ? "ここへ配置" : "空き列";
      slotEl.appendChild(empty);
    } else {
      slotBlocks.forEach(block => {
        const item = document.createElement("div");
        item.className = "lane-item";
        item.dataset.blockId = block.blockId;

        if (spec.activeSlots.includes(slotIndex)) {
          bindBlockDrop(item, lane.id, slotIndex, block.blockId);
        }

        item.appendChild(buildBlockCard(block, lane, laneBodyHeight, false));
        slotEl.appendChild(item);
      });
    }

    slots.appendChild(slotEl);
  }

  body.appendChild(slots);
  laneEl.appendChild(body);
  return laneEl;
}

function getLaneUsedTrays(laneId) {
  return blocks
    .filter(block => block.laneId === laneId)
    .reduce((sum, block) => sum + block.trays, 0);
}

function getLaneSlotBlocks(laneId, slotIndex) {
  return blocks
    .filter(block => block.laneId === laneId && block.slotIndex === slotIndex)
    .sort((a, b) => a.order - b.order);
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

function buildBlockCard(block, lane = null, laneBodyHeight = 0, compact = false) {
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

  if (lane) {
    card.style.height = `${computeBlockHeight(block.trays, lane, laneBodyHeight)}px`;
  }

  card.draggable = true;
  card.addEventListener("dragstart", e => {
    dragBlockId = block.blockId;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", block.blockId);
    }
  });

  card.addEventListener("dragend", () => {
    dragBlockId = "";
  });

  card.innerHTML = `
    <div class="lot-name">${escapeHtml(lot.variety)}</div>
    <div class="lot-ref">${escapeHtml(lot.seedRef)}</div>
    <div class="lot-meta">配置 ${formatNum(block.trays)} 枚 / 元在庫 ${formatNum(lot.availableTrays)} 枚</div>
    <div class="lot-meta">定植 ${formatNum(lot.plantedTrays)} / 破棄 ${formatNum(lot.discardedTrays)} / ${escapeHtml(lot.trayType)}穴</div>
  `;

  if (compact) {
    const dateEl = document.createElement("div");
    dateEl.className = "lot-meta lot-seed-date";
    dateEl.textContent = `播種 ${lot.seedDate || "日付なし"}`;
    card.appendChild(dateEl);
  }

  return card;
}

function bindBlockDrop(el, laneId, slotIndex, beforeBlockId) {
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

    const blockId = dragBlockId || String(e.dataTransfer?.getData("text/plain") || "").trim();
    if (!blockId) return;

    placeBlock(blockId, laneId, slotIndex, beforeBlockId);
    render();
  });
}

function placeBlock(blockId, laneId, slotIndex, beforeBlockId = "") {
  const target = blocks.find(block => block.blockId === blockId);
  if (!target) return;

  target.laneId = laneId;
  target.slotIndex = Math.max(0, Math.floor(toNumber(slotIndex)));

  const laneBlocks = blocks
    .filter(block => block.blockId !== blockId && block.laneId === laneId && block.slotIndex === target.slotIndex)
    .sort((a, b) => a.order - b.order);

  if (beforeBlockId) {
    const before = laneBlocks.find(block => block.blockId === beforeBlockId);
    if (before) {
      target.order = before.order - 0.5;
    } else {
      target.order = laneBlocks.length;
    }
  } else {
    target.order = laneBlocks.length;
  }

  blocks = normalizeBlockOrders(blocks);
}

function toggleSelection(blockId, multiSelect) {
  if (!multiSelect) {
    if (selectedBlockIds.size === 1 && selectedBlockIds.has(blockId)) {
      selectedBlockIds.clear();
      return;
    }
    selectedBlockIds.clear();
    selectedBlockIds.add(blockId);
    return;
  }

  if (selectedBlockIds.has(blockId)) {
    selectedBlockIds.delete(blockId);
  } else {
    selectedBlockIds.add(blockId);
  }
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
    slotIndex: target.slotIndex,
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
    alert("結合するブロックを2つ以上選択してください。Ctrl/Command+クリックで複数選択できます。");
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
  const sameSlot = targets.every(block => block.slotIndex === first.slotIndex);

  if (!sameOrigin || !sameLane || !sameSlot) {
    alert("結合は同一ロット・同一レーン・同一列のブロックのみ可能です。");
    return;
  }

  const merged = roundTray(targets.reduce((sum, block) => sum + block.trays, 0));
  first.trays = merged;

  const dropIds = new Set(targets.slice(1).map(block => block.blockId));
  blocks = blocks.filter(block => !dropIds.has(block.blockId));
  blocks = normalizeBlockOrders(blocks);

  selectedBlockIds.clear();
  selectedBlockIds.add(first.blockId);
  render();
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

function getLaneRows(lane) {
  const cols = getLaneCols(lane);
  const capacity = toNumber(lane?.capacity);
  if (capacity <= 0) return 24;
  return Math.max(1, capacity / cols);
}

function getLaneLayoutOptions(lane) {
  const cols = getLaneCols(lane);
  const options = [{ value: "default", label: `標準(${cols}列)` }];

  if (cols >= 3) {
    options.push({ value: "minus1", label: `${Math.max(1, cols - 1)}列運用(1列空き)` });
  }

  if (cols === 5) {
    options.push({ value: "split-2-3", label: "2列+3列" });
  }

  return options;
}

function getLaneLayoutMode(laneId) {
  const lane = findLane(laneId);
  if (!lane) return "default";

  const mode = String(laneLayouts?.[laneId]?.mode || "default");
  const allowed = getLaneLayoutOptions(lane).map(v => v.value);
  return allowed.includes(mode) ? mode : "default";
}

function getLaneLayoutSpec(lane) {
  const cols = getLaneCols(lane);
  const mode = getLaneLayoutMode(lane.id);

  if (mode === "minus1") {
    return {
      slotCount: cols,
      activeSlots: Array.from({ length: Math.max(1, cols - 1) }, (_, i) => i),
      groupBreakAfter: []
    };
  }

  if (mode === "split-2-3" && cols === 5) {
    return {
      slotCount: 5,
      activeSlots: [0, 1, 2, 3, 4],
      groupBreakAfter: [1]
    };
  }

  return {
    slotCount: cols,
    activeSlots: Array.from({ length: cols }, (_, i) => i),
    groupBreakAfter: []
  };
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

function computeLaneBodyHeight(lane) {
  if (isOutsideBottomLane(lane)) {
    const tray = getTraySizeByLane(lane);
    const shortEdgeMm = Math.min(tray.ewMm, tray.nsMm);
    const px = getLaneCols(lane) * shortEdgeMm * MM_TO_PX * 12;
    return clamp(Math.round(px), 90, 150);
  }

  const rows = getLaneRows(lane);
  const tray = getTraySizeByLane(lane);
  const px = rows * tray.nsMm * MM_TO_PX;
  return clamp(Math.round(px), 130, 920);
}

function computeBlockHeight(blockTrays, lane, laneBodyHeight = 0) {
  const laneCapacity = toNumber(lane?.capacity);
  const trays = Math.max(0, toNumber(blockTrays));

  if (laneCapacity > 0 && laneBodyHeight > 0) {
    const ratio = trays / laneCapacity;
    const proportional = Math.round(laneBodyHeight * ratio);
    if (trays <= 0) return 22;
    return clamp(proportional, 24, Math.max(28, laneBodyHeight - 6));
  }

  const cols = getLaneCols(lane || {});
  if (trays <= 0) return 40;

  const rows = trays / cols;
  const tray = getTraySizeByLane(lane || {});
  const px = rows * tray.nsMm * MM_TO_PX;
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
