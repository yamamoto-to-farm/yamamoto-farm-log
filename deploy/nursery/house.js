import { loadCSV, normalizeKeys } from "/common/csv.js";
import { saveJSON } from "/common/json.js";

const LAYOUT_PATH = "logs/nursery/house-layout.json";

const TRAY_WIDTH_MM = 300;
const TRAY_LENGTH_MM = 600;
const MM_TO_PX = 0.0088;
const SNAP_PX = 24;

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
const selectedBlockIds = new Set();

const resizeState = {
  active: false,
  blockId: "",
  laneId: "",
  startX: 0,
  startCols: 1,
  laneCols: 1,
  colPx: 1,
  laneBodyHeight: 0
};

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

  zonesRoot.addEventListener("click", event => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const handle = target.closest(".block-resize-handle");
    if (handle) return;

    const cardEl = target.closest(".lot-card[data-block-id]");
    if (cardEl) {
      const blockId = String(cardEl.getAttribute("data-block-id") || "").trim();
      if (!blockId) return;
      toggleSelection(blockId, event.ctrlKey || event.metaKey);
      renderGroups();
      return;
    }

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
    const laneCols = validLane ? getLaneCols(findLane(validLane)) : 1;
    const rawSpan = Math.max(1, Math.floor(toNumber(row?.spanCols) || laneCols));

    const block = {
      blockId: String(row?.blockId || "").trim() || newBlockId(originSeedRef),
      originSeedRef,
      trays,
      laneId: validLane,
      spanCols: Math.min(laneCols, rawSpan),
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
  renderSummary();
  renderGroups();
}

function renderSummary() {
  const total = lots.length;
  const active = lots.filter(v => v.availableTrays > 0).length;
  const assignedSeedRefs = new Set(blocks.filter(block => !!block.laneId).map(block => block.originSeedRef));

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
  if (focusedLaneId && !findLane(focusedLaneId)) focusedLaneId = "";
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
      const span = Math.max(1, Math.min(getLaneCols(lane), Math.floor(toNumber(block.spanCols) || 1)));
      const widthPct = (span / getLaneCols(lane)) * 100;
      const blockHeightPx = computeBlockHeight(block.trays, lane, laneBodyHeight, span);
      const heightPct = clamp((blockHeightPx / laneBodyHeight) * 100, 4, 100);
      const x = clamp(toNumber(block.posX), 0, 1);
      const y = clamp(toNumber(block.posY), 0, 1);
      const leftPct = x * Math.max(0, 100 - widthPct);
      const topPct = y * Math.max(0, 100 - heightPct);

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
    card.style.height = `${computeBlockHeight(block.trays, lane, laneBodyHeight, block.spanCols)}px`;
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

  if (lane) {
    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = "block-resize-handle";
    handle.title = "角をドラッグして列幅を変更";
    handle.textContent = "";
    handle.addEventListener("mousedown", e => startResizeBlock(e, block.blockId, lane.id));
    card.appendChild(handle);
  }

  return card;
}

function startResizeBlock(event, blockId, laneId) {
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
  resizeState.startX = event.clientX;
  resizeState.startCols = Math.max(1, Math.min(laneCols, block.spanCols || laneCols));
  resizeState.laneCols = laneCols;
  resizeState.colPx = colPx;
  resizeState.laneBodyHeight = laneBody.clientHeight;

  window.addEventListener("mousemove", onResizeMove);
  window.addEventListener("mouseup", stopResizeBlock, { once: true });
}

function onResizeMove(event) {
  if (!resizeState.active) return;

  const block = blocks.find(v => v.blockId === resizeState.blockId);
  const lane = findLane(resizeState.laneId);
  const laneBody = document.querySelector(`.lane-body[data-lane-id="${CSS.escape(resizeState.laneId)}"]`);
  if (!block || !lane || !(laneBody instanceof HTMLElement)) return;

  const deltaCols = Math.round((event.clientX - resizeState.startX) / resizeState.colPx);
  const nextCols = clamp(resizeState.startCols + deltaCols, 1, resizeState.laneCols);

  if (block.spanCols === nextCols) return;

  const resolved = resolvePlacementInLane({
    lane,
    laneBodyEl: laneBody,
    laneBodyHeight: resizeState.laneBodyHeight || laneBody.clientHeight,
    movingBlockId: block.blockId,
    trays: block.trays,
    spanCols: nextCols,
    preferredX: clamp(toNumber(block.posX), 0, 1),
    preferredY: clamp(toNumber(block.posY), 0, 1)
  });

  if (!resolved) return;

  block.spanCols = nextCols;
  block.posX = resolved.x;
  block.posY = resolved.y;
  renderGroups();
}

function stopResizeBlock() {
  window.removeEventListener("mousemove", onResizeMove);
  resizeState.active = false;
}

function bindBlockDrop(el, lane, laneBodyHeight, beforeBlockId) {
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

    const moved = placeBlock(blockId, lane, laneBodyHeight, e, beforeBlockId);
    if (moved) render();
  });
}

function placeBlock(blockId, lane, laneBodyHeight, dropEvent, beforeBlockId = "") {
  const target = blocks.find(block => block.blockId === blockId);
  if (!target || !lane) return false;

  const laneBody = document.querySelector(`.lane-body[data-lane-id="${CSS.escape(lane.id)}"]`);
  if (!(laneBody instanceof HTMLElement)) return false;

  const laneCols = getLaneCols(lane);
  const spanCols = Math.max(1, Math.min(laneCols, Math.floor(toNumber(target.spanCols) || laneCols)));

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

function resolvePlacementInLane({ lane, laneBodyEl, laneBodyHeight, movingBlockId, trays, spanCols, preferredX, preferredY }) {
  const laneCols = getLaneCols(lane);
  const widthNorm = clamp(spanCols / laneCols, 0.05, 1);
  const heightPx = computeBlockHeight(trays, lane, laneBodyHeight, spanCols);
  const heightNorm = clamp(heightPx / Math.max(1, laneBodyHeight), 0.04, 1);

  const maxX = Math.max(0, 1 - widthNorm);
  const maxY = Math.max(0, 1 - heightNorm);

  const stepX = clamp(SNAP_PX / Math.max(1, laneBodyEl.clientWidth), 0.01, 0.2);
  const stepY = clamp(SNAP_PX / Math.max(1, laneBodyHeight), 0.01, 0.2);

  const prefX = snapToStep(clamp(preferredX, 0, maxX), stepX, maxX);
  const prefY = snapToStep(clamp(preferredY, 0, maxY), stepY, maxY);

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

  const others = blocks
    .filter(block => block.blockId !== movingBlockId && block.laneId === lane.id)
    .map(block => getBlockRectNorm(block, lane, laneBodyHeight));

  for (const c of candidates) {
    const rect = {
      left: c.x,
      top: c.y,
      right: c.x + widthNorm,
      bottom: c.y + heightNorm
    };

    const overlapped = others.some(other => isRectOverlap(rect, other));
    if (!overlapped) {
      return { x: c.x, y: c.y };
    }
  }

  return null;
}

function getBlockRectNorm(block, lane, laneBodyHeight) {
  const laneCols = getLaneCols(lane);
  const span = Math.max(1, Math.min(laneCols, Math.floor(toNumber(block.spanCols) || 1)));
  const width = clamp(span / laneCols, 0.05, 1);
  const heightPx = computeBlockHeight(block.trays, lane, laneBodyHeight, span);
  const height = clamp(heightPx / Math.max(1, laneBodyHeight), 0.04, 1);

  const x = clamp(toNumber(block.posX), 0, 1) * Math.max(0, 1 - width);
  const y = clamp(toNumber(block.posY), 0, 1) * Math.max(0, 1 - height);

  return {
    left: x,
    top: y,
    right: x + width,
    bottom: y + height
  };
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
    if (selectedBlockIds.size === 1 && selectedBlockIds.has(blockId)) {
      selectedBlockIds.clear();
      return;
    }
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
    return clamp(Math.round(px), 90, 170);
  }

  const rows = getLaneRows(lane);
  const tray = getTraySizeByLane(lane);
  const px = rows * tray.nsMm * MM_TO_PX;
  return clamp(Math.round(px), 130, 920);
}

function computeBlockHeight(blockTrays, lane, laneBodyHeight = 0, spanCols = 1) {
  const laneCapacity = toNumber(lane?.capacity);
  const trays = Math.max(0, toNumber(blockTrays));
  const laneCols = getLaneCols(lane || {});
  const cols = Math.max(1, Math.min(laneCols, Math.floor(toNumber(spanCols) || 1)));

  if (laneCapacity > 0 && laneBodyHeight > 0) {
    const ratio = trays / laneCapacity;
    const adjusted = laneBodyHeight * ratio * (laneCols / cols);
    if (trays <= 0) return 22;
    return clamp(Math.round(adjusted), 24, Math.max(28, laneBodyHeight - 6));
  }

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
