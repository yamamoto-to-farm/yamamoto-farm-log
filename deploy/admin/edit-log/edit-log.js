import { loadJSON } from "/common/json.js?v=1";
import { saveLog } from "/common/save/index.js?v=1";
import { safeFieldName } from "/common/utils.js?v=1";
import { rebuildMonthlyWorkSummary } from "/common/monthly-work-summary.js?v=1";
import { openFieldModal } from "/common/filter/filter-field.js?v=1";
import { getFilterData, setFilterData } from "/common/filter/filter-core.js?v=1";

let state = {
  fields: [],
  rows: [],
  originalRows: [],
  selectedIndex: null,
  loadedField: "",
  loadedDate: "",
  eventIdBackfills: {},
  allCsvHeader: [],
  allCsvRows: [],
  allCsvDisplayRows: [],
  allCsvVirtual: {
    rowHeight: 34,
    overscan: 16,
    start: 0,
    end: 0
  },
  rowFilters: {
    workType: "",
    worker: ""
  },
  machines: [],
  attachmentIndex: {},
  diffRenderQueued: false
};

const NUMERIC_KEYS = new Set([
  "depthCm",
  "speedKmh",
  "ridgeCount",
  "ridgeHeightCm",
  "ridgeWidthCm",
  "sourceRidgeCount",
  "sourceRidgeHeightCm",
  "sourceRidgeWidthCm",
  "irrigationMinutes"
]);

const TYPE_SUGGESTED_KEYS = {
  fertilizer: ["date", "workType", "workers", "machine", "notes", "fertilizerItems", "distributed", "sourceWorkType", "sourceWork", "sourceRidgeCount", "sourceRidgeHeightCm", "sourceRidgeWidthCm", "attachment"],
  pesticide: ["date", "workType", "workers", "machine", "notes", "distributed", "attachment"],
  tillage: ["date", "workType", "workers", "machine", "notes", "depthCm", "speedKmh", "attachment"],
  weeding: ["date", "workType", "workers", "machine", "notes", "sprayMethod", "mowingMethod", "pesticides", "pesticideUsage", "distributed", "attachment"],
  "hand-weeding": ["date", "workType", "workers", "machine", "notes", "attachment"],
  watering: ["date", "workType", "workers", "machine", "notes", "startTime", "endTime", "irrigationMinutes", "attachment"],
  intertill: ["date", "workType", "workers", "machine", "notes", "ridgeCount", "ridgeHeightCm", "ridgeWidthCm", "attachment"],
  bedmaking: ["date", "workType", "workers", "machine", "notes", "ridgeCount", "ridgeHeightCm", "ridgeWidthCm", "attachment"],
  "field-maintenance": ["date", "workType", "workers", "machine", "notes", "attachment"]
};

const WORKTYPE_OPTIONS = {
  weeding: ["除草剤散布", "草刈り"],
  tillage: ["耕うん(ロータリー)", "プラソイラー", "整地", "土壌改良"],
  "field-maintenance": ["整地", "補修", "草刈り", "清掃"],
  watering: ["潅水"],
  fertilizer: ["施肥"],
  pesticide: ["防除"],
  intertill: ["中耕"],
  bedmaking: ["畝立て"],
  "hand-weeding": ["草とり"]
};

const DEFAULT_MOWING_METHODS = ["背負い式刈払機", "フレールモア", "オフセットモア"];
const DEFAULT_SPRAY_METHODS = ["背負動力噴霧機", "エンジン動噴", "小型ブームスプレーヤ(BSM201)"];

const TYPE_TO_MACHINE_PAGE_ID = {
  tillage: "tillage",
  weeding: "weeding-machine",
  "hand-weeding": "weeding-machine",
  intertill: "intertill",
  bedmaking: "bedmaking",
  "field-maintenance": "field-maintenance"
};

const FLAT_ENTRIES_CACHE = new WeakMap();
const ROW_BG_SELECTED = "#f5faff";
const ROW_BG_NORMAL = "transparent";
const ALLCSV_VIRTUAL_THRESHOLD = 220;

export async function initEditLogPage() {
  await loadMasterData();
  bindEvents();

  const dateEl = document.getElementById("target-date");
  if (dateEl) dateEl.value = new Date().toISOString().slice(0, 10);

  updateTargetFieldLabel();
  updateTargetModeUI();
  updateActionAvailability();
  renderDynamicFieldEditor();
  renderDiffPreview();
  setStatus("ログタイプと編集対象を選んで読み込んでください。");
}

async function loadMasterData() {
  const fields = await loadJSON("/data/fields.json").catch(() => []);
  const fieldList = Array.isArray(fields) ? fields : [];
  state.fields = fieldList.map(f => f.name).filter(Boolean);

  const parents = [];
  const children = {};
  fieldList.forEach(f => {
    const area = String(f?.area || "").trim() || "未分類";
    const name = String(f?.name || "").trim();
    if (!name) return;
    if (!children[area]) {
      children[area] = [];
      parents.push(area);
    }
    children[area].push(name);
  });

  const current = getFilterData();
  setFilterData({
    ...current,
    fields: { parents, children }
  });

  const machines = await loadJSON("/data/machines.json").catch(() => ({ machines: [] }));
  state.machines = Array.isArray(machines?.machines) ? machines.machines : [];

  const attachment = await loadJSON("/data/attachment-index.json").catch(() => ({}));
  state.attachmentIndex = attachment && typeof attachment === "object" ? attachment : {};
}

function bindEvents() {
  const loadBtn = document.getElementById("load-btn");
  if (loadBtn) loadBtn.onclick = () => loadSelectedLog();

  const addBtn = document.getElementById("add-row-btn");
  if (addBtn) {
    addBtn.onclick = () => {
      if (getTargetMode() === "date") return;
      state.rows.push(createEmptyRow());
      renderRows();
      setSelectedRowIndex(state.rows.length - 1);
      scheduleDiffPreviewRender();
    };
  }

  const deleteBtn = document.getElementById("delete-row-btn");
  if (deleteBtn) {
    deleteBtn.onclick = () => {
      if (state.selectedIndex == null) {
        alert("削除する行を選択してください");
        return;
      }
      state.rows.splice(state.selectedIndex, 1);
      renderRows();
      setSelectedRowIndex(null);
      scheduleDiffPreviewRender();
    };
  }

  const saveBtn = document.getElementById("save-btn");
  if (saveBtn) saveBtn.onclick = () => saveCurrentLog();

  const pickFieldBtn = document.getElementById("pick-field-btn");
  if (pickFieldBtn) {
    pickFieldBtn.onclick = async () => {
      try {
        await openFieldModal({
          mode: "select",
          includeExpired: true,
          onSelect: (name) => {
            state.loadedField = name;
            updateTargetFieldLabel();
          }
        });
      } catch (e) {
        console.warn("[edit-log] field modal open failed:", e);
        alert("圃場選択モーダルの表示に失敗しました。ページを再読み込みして再試行してください。");
      }
    };
  }

  document.querySelectorAll("input[name='target-mode']").forEach(el => {
    el.addEventListener("change", () => {
      updateTargetModeUI();
      updateActionAvailability();
      renderAllCsvPreview();
    });
  });

  const typeEl = document.getElementById("log-type");
  if (typeEl) {
    typeEl.addEventListener("change", () => {
      renderDynamicFieldEditor();
      renderAllCsvPreview();
      scheduleDiffPreviewRender();
    });
  }

  const workTypeFilter = document.getElementById("filter-worktype");
  if (workTypeFilter) {
    workTypeFilter.addEventListener("input", () => {
      state.rowFilters.workType = String(workTypeFilter.value || "").trim();
      renderRows();
    });
  }

  const workerFilter = document.getElementById("filter-worker");
  if (workerFilter) {
    workerFilter.addEventListener("input", () => {
      state.rowFilters.worker = String(workerFilter.value || "").trim();
      renderRows();
    });
  }

  const clearFiltersBtn = document.getElementById("clear-filters-btn");
  if (clearFiltersBtn) {
    clearFiltersBtn.addEventListener("click", () => {
      state.rowFilters.workType = "";
      state.rowFilters.worker = "";
      if (workTypeFilter) workTypeFilter.value = "";
      if (workerFilter) workerFilter.value = "";
      renderRows();
    });
  }

  const allCsvScroll = document.getElementById("all-csv-scroll");
  if (allCsvScroll) {
    allCsvScroll.addEventListener("scroll", () => renderAllCsvVirtualWindow());
  }

  window.addEventListener("resize", () => renderAllCsvVirtualWindow());

  document.addEventListener("keydown", handleGlobalKeydown);
}

function updateTargetFieldLabel() {
  const label = document.getElementById("target-field-label");
  if (label) label.textContent = state.loadedField || "未選択";
}

function updateTargetModeUI() {
  const mode = getTargetMode();
  const fw = document.getElementById("target-field-wrap");
  const dw = document.getElementById("target-date-wrap");
  if (fw) fw.style.display = mode === "field" ? "block" : "none";
  if (dw) dw.style.display = mode === "date" ? "block" : "none";
}

function updateActionAvailability() {
  const mode = getTargetMode();
  const addBtn = document.getElementById("add-row-btn");

  if (addBtn) {
    addBtn.disabled = mode === "date";
    addBtn.title = mode === "date" ? "日付モードは既存ログ同時修正のため行追加不可" : "";
  }
}

async function loadSelectedLog() {
  const type = getLogType();
  if (!type) {
    alert("ログタイプを選択してください");
    return;
  }

  state.eventIdBackfills = {};

  if (getTargetMode() === "field") {
    if (!state.loadedField) {
      alert("圃場を選択してください");
      return;
    }
    await loadByField(type, state.loadedField);
    return;
  }

  const date = document.getElementById("target-date")?.value || "";
  if (!date) {
    alert("日付を選択してください");
    return;
  }
  await loadByDate(type, date);
}

async function loadByField(type, field) {
  const safe = safeFieldName(field);
  const data = await loadJSON(`/logs/${type}/${safe}.json`).catch(() => ({ field: safe, years: {} }));
  if (supplementMissingEventIdsInLogData(data)) {
    state.eventIdBackfills[safe] = data;
  }

  const rows = flattenEntriesCached(data)
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
    .map(e => toEditableRow(e, [field], createEntryFingerprint(e)));

  state.rows = rows;
  state.originalRows = deepClone(rows);
  state.loadedDate = "";
  state.selectedIndex = null;

  renderRows();
  renderDynamicFieldEditor();
  renderDiffPreview();
  await loadAllCsvPreview(type);
  setStatus(`${field} / ${type} を読み込みました（${rows.length}件）`);
}

async function loadByDate(type, date) {
  const groups = new Map();

  const loadedFields = await Promise.all(
    state.fields.map(async fieldName => {
      const safe = safeFieldName(fieldName);
      const data = await loadJSON(`/logs/${type}/${safe}.json`).catch(() => null);
      if (data && supplementMissingEventIdsInLogData(data)) {
        state.eventIdBackfills[safe] = data;
      }
      return { fieldName, data };
    })
  );

  loadedFields.forEach(({ fieldName, data }) => {
    if (!data) return;

    const entries = flattenEntriesCached(data).filter(e => String(e.date || "").slice(0, 10) === date);
    entries.forEach(entry => {
      const fp = createEntryFingerprint(entry);
      if (!groups.has(fp)) {
        groups.set(fp, { raw: deepClone(entry), fields: [], beforeFingerprint: fp });
      }
      const g = groups.get(fp);
      if (!g.fields.includes(fieldName)) g.fields.push(fieldName);
    });
  });

  const rows = Array.from(groups.values())
    .map(g => toEditableRow(g.raw, g.fields.slice().sort((a, b) => a.localeCompare(b)), g.beforeFingerprint))
    .sort((a, b) => String(a.workType || "").localeCompare(String(b.workType || "")));

  state.rows = rows;
  state.originalRows = deepClone(rows);
  state.loadedDate = date;
  state.selectedIndex = null;

  renderRows();
  renderDynamicFieldEditor();
  renderDiffPreview();

  if (rows.length > 0) {
    await loadAllCsvPreview(type);
  } else {
    clearAllCsvPreviewForNoMatch(date);
  }

  const fieldsCount = new Set(rows.flatMap(r => r.fields)).size;
  setStatus(`${date} / ${type} を読み込みました（${rows.length}件, ${fieldsCount}圃場）`);
}

function clearAllCsvPreviewForNoMatch(date) {
  state.allCsvHeader = [];
  state.allCsvRows = [];
  state.allCsvDisplayRows = [];

  const thead = document.getElementById("all-csv-head");
  const tbody = document.getElementById("all-csv-rows");
  const status = document.getElementById("all-csv-status");

  if (thead) thead.innerHTML = "";
  if (tbody) tbody.innerHTML = "";
  if (status) status.textContent = `${date} は該当ログ0件のため、all.csv は未読込です`;
}

function renderRows() {
  const tbody = document.getElementById("edit-rows");
  if (!tbody) return;

  tbody.innerHTML = "";
  const frag = document.createDocumentFragment();
  const filteredIndexes = getFilteredRowIndexes();
  if (state.selectedIndex != null && !filteredIndexes.includes(state.selectedIndex)) {
    state.selectedIndex = null;
    renderDynamicFieldEditor();
  }
  let serial = 1;

  filteredIndexes.forEach(idx => {
    const row = state.rows[idx];
    const tr = document.createElement("tr");
    tr.dataset.index = String(idx);
    tr.style.borderBottom = "1px solid #eee";
    tr.style.background = state.selectedIndex === idx ? ROW_BG_SELECTED : ROW_BG_NORMAL;

    tr.innerHTML = `
      <td style="padding:6px;">${serial++}</td>
      <td data-col="fields" style="padding:6px; color:#333; white-space:normal; line-height:1.4;">${escapeHtml((row.fields || []).join("／"))}</td>
      <td style="padding:6px;"><input data-key="date" type="date" class="form-input" value="${escapeAttr(row.date)}"></td>
      <td style="padding:6px;"><input data-key="workType" type="text" class="form-input" value="${escapeAttr(row.workType)}"></td>
      <td style="padding:6px;"><input data-key="machine" type="text" class="form-input" value="${escapeAttr(row.machine)}"></td>
      <td style="padding:6px;"><input data-key="workersText" type="text" class="form-input" value="${escapeAttr(row.workersText)}"></td>
      <td style="padding:6px;"><input data-key="notes" type="text" class="form-input" value="${escapeAttr(row.notes)}"></td>
    `;

    tr.addEventListener("click", () => {
      setSelectedRowIndex(idx, { toggle: true });
    });

    tr.querySelectorAll("input").forEach(input => {
      input.addEventListener("input", () => {
        const key = input.dataset.key;
        if (!key) return;
        updateRowField(state.rows[idx], key, input.value);
        if (state.selectedIndex === idx && key === "workType") {
          renderDynamicFieldEditor();
        }
        scheduleDiffPreviewRender();
      });

      input.addEventListener("click", ev => {
        ev.stopPropagation();
        setSelectedRowIndex(idx);
      });
    });

    frag.appendChild(tr);
  });

  tbody.appendChild(frag);
  renderFilterStatus(filteredIndexes.length, state.rows.length);
  updateRowSelectionUI();
}

function getFilteredRowIndexes() {
  const indexes = [];
  state.rows.forEach((row, idx) => {
    if (rowMatchesFilters(row)) indexes.push(idx);
  });
  return indexes;
}

function rowMatchesFilters(row) {
  const wtFilter = normalizeTextForSearch(state.rowFilters.workType);
  const workerFilter = normalizeTextForSearch(state.rowFilters.worker);

  if (wtFilter) {
    const wt = normalizeTextForSearch(row?.workType);
    if (!wt.includes(wtFilter)) return false;
  }

  if (workerFilter) {
    const worker = normalizeTextForSearch(row?.workersText);
    if (!worker.includes(workerFilter)) return false;
  }

  return true;
}

function renderFilterStatus(filteredCount, totalCount) {
  const el = document.getElementById("filter-status");
  if (!el) return;

  const wt = state.rowFilters.workType;
  const worker = state.rowFilters.worker;
  if (!wt && !worker) {
    el.textContent = `フィルタ: なし（${totalCount}件）`;
    return;
  }

  const parts = [];
  if (wt) parts.push(`作業内容: ${wt}`);
  if (worker) parts.push(`作業者: ${worker}`);
  el.textContent = `フィルタ: ${parts.join(" / ")}（${filteredCount} / ${totalCount}件）`;
}

function normalizeTextForSearch(value) {
  return String(value || "").trim().toLowerCase();
}

function setSelectedRowIndex(nextIndex, options = {}) {
  const { toggle = false } = options;
  let resolved = nextIndex;
  if (toggle) {
    resolved = state.selectedIndex === nextIndex ? null : nextIndex;
  }

  if (state.selectedIndex === resolved) return;
  state.selectedIndex = resolved;
  updateRowSelectionUI();
  renderDynamicFieldEditor();
}

function updateRowSelectionUI() {
  const tbody = document.getElementById("edit-rows");
  if (!tbody) return;

  tbody.querySelectorAll("tr[data-index]").forEach(tr => {
    const idx = Number(tr.dataset.index);
    const selected = idx === state.selectedIndex;
    tr.style.background = selected ? ROW_BG_SELECTED : ROW_BG_NORMAL;
  });
}

function handleGlobalKeydown(ev) {
  const isSave = (ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "s";
  if (isSave) {
    ev.preventDefault();
    saveCurrentLog();
    return;
  }

  const active = document.activeElement;
  const tag = (active?.tagName || "").toLowerCase();
  const isTyping = tag === "input" || tag === "textarea" || tag === "select";

  if (ev.key === "Escape" && state.selectedIndex != null) {
    setSelectedRowIndex(null);
    return;
  }

  if (isTyping) return;
  const filteredIndexes = getFilteredRowIndexes();
  if (!filteredIndexes.length) return;

  if (ev.key === "ArrowDown") {
    ev.preventDefault();
    const pos = filteredIndexes.indexOf(state.selectedIndex);
    const next = pos < 0
      ? filteredIndexes[0]
      : filteredIndexes[Math.min(filteredIndexes.length - 1, pos + 1)];
    setSelectedRowIndex(next);
  }

  if (ev.key === "ArrowUp") {
    ev.preventDefault();
    const pos = filteredIndexes.indexOf(state.selectedIndex);
    const next = pos < 0
      ? filteredIndexes[filteredIndexes.length - 1]
      : filteredIndexes[Math.max(0, pos - 1)];
    setSelectedRowIndex(next);
  }
}

async function saveCurrentLog() {
  const type = getLogType();
  if (!type) {
    alert("ログタイプを選択してください");
    return;
  }

  if (getTargetMode() === "field") {
    await saveFieldMode(type);
  } else {
    await saveDateMode(type);
  }
}

async function saveFieldMode(type) {
  const field = state.loadedField;
  if (!field) {
    alert("圃場を選択してください");
    return;
  }

  const normalizedRows = state.rows.map(r => normalizeRow(r)).filter(r => !isAllBlank(r));
  if (normalizedRows.some(r => !r.date)) {
    alert("日付が空の行があります");
    return;
  }

  const rowUpdates = normalizedRows.map(r => ({
    beforeFingerprint: r.beforeFingerprint,
    afterEntry: buildEntryFromRow(r)
  }));

  const safe = safeFieldName(field);
  const fieldOverrides = {
    [safe]: toLogFileObject(field, rowUpdates.map(v => v.afterEntry))
  };

  let linkedUpdatedCount = 0;
  if (isSyncRelatedEnabled()) {
    const related = await applyRelatedUpdates(type, field, rowUpdates);
    Object.assign(fieldOverrides, related.overrides);
    linkedUpdatedCount = related.updatedCount;
  }

  await saveWithCsvRebuild(type, fieldOverrides);
  await loadAllCsvPreview(type);
  state.originalRows = deepClone(state.rows);
  renderDiffPreview();
  setStatus(`保存しました: ${field} / ${type}（${normalizedRows.length}件, 同時修正 ${linkedUpdatedCount}件）`);
}

async function saveDateMode(type) {
  const date = state.loadedDate || (document.getElementById("target-date")?.value || "");
  if (!date) {
    alert("日付を選択してください");
    return;
  }

  const currentRows = state.rows.map(r => normalizeRow(r)).filter(r => !isAllBlank(r));
  if (currentRows.some(r => !r.date)) {
    alert("日付が空の行があります");
    return;
  }

  const currentMap = new Map();
  currentRows.forEach(r => {
    if (r.beforeFingerprint) {
      currentMap.set(r.beforeFingerprint, buildEntryFromRow(r));
    }
  });

  const originalSet = new Set(state.originalRows.map(r => String(r.beforeFingerprint || "")).filter(Boolean));
  const deletedSet = new Set(Array.from(originalSet).filter(fp => !currentMap.has(fp)));

  const fieldOverrides = {};
  let touched = 0;

  const processed = await Promise.all(
    state.fields.map(async fieldName => {
      const safe = safeFieldName(fieldName);
      const data = await loadJSON(`/logs/${type}/${safe}.json`).catch(() => null);
      if (!data?.years || typeof data.years !== "object") return null;

      let changed = false;
      let touchedLocal = 0;

      Object.keys(data.years).forEach(year => {
        const entries = data.years[year]?.entries;
        if (!Array.isArray(entries)) return;

        const next = [];
        entries.forEach(entry => {
          if (String(entry?.date || "").slice(0, 10) !== date) {
            next.push(entry);
            return;
          }

          const fp = createEntryFingerprint(entry);
          if (deletedSet.has(fp)) {
            changed = true;
            return;
          }

          if (currentMap.has(fp)) {
            next.push(mergeEntryForRelatedField(entry, currentMap.get(fp)));
            changed = true;
            touchedLocal += 1;
            return;
          }

          next.push(entry);
        });

        data.years[year].entries = next;
      });

      if (!changed) return null;
      return { safe, data, touchedLocal };
    })
  );

  processed.forEach(item => {
    if (!item) return;
    fieldOverrides[item.safe] = item.data;
    touched += item.touchedLocal;
  });

  Object.entries(state.eventIdBackfills || {}).forEach(([safe, data]) => {
    if (!fieldOverrides[safe]) fieldOverrides[safe] = data;
  });

  if (Object.keys(fieldOverrides).length === 0) {
    alert("更新対象がありませんでした");
    return;
  }

  await saveWithCsvRebuild(type, fieldOverrides);
  await loadByDate(type, date);
  setStatus(`保存しました: ${date} / ${type}（更新 ${touched}件）`);
}

async function saveWithCsvRebuild(type, fieldOverrides) {
  Object.values(fieldOverrides).forEach(data => {
    supplementMissingEventIdsInLogData(data);
  });

  setStatus("all.csv を再生成しています…");
  const csvText = await rebuildAllCsv(type, fieldOverrides);

  const files = Object.entries(fieldOverrides).map(([safeName, dataObj]) => ({
    path: `logs/${type}/${safeName}.json`,
    content: JSON.stringify(dataObj, null, 2)
  }));

  files.push({
    path: `logs/${type}/all.csv`,
    content: csvText
  });

  await saveLog({ type: "multi", files });
  await rebuildMonthlyWorkSummary().catch(e => {
    console.warn("[edit-log] monthly work summary rebuild failed:", e);
  });

  state.eventIdBackfills = {};
}

async function rebuildAllCsv(type, fieldOverrides = {}) {
  const existingCsv = await loadAllCsvRaw(type);
  const headerCols = chooseAllCsvHeader(type, existingCsv.header);
  const loaded = await Promise.all(
    state.fields.map(async fieldName => {
      const safe = safeFieldName(fieldName);
      const override = fieldOverrides[safe] || null;
      const data = override || await loadJSON(`/logs/${type}/${safe}.json`).catch(() => null);
      return { fieldName, data };
    })
  );

  const rows = [];
  loaded.forEach(({ fieldName, data }) => {
    if (!data) return;
    flattenEntriesCached(data).forEach(e => rows.push(buildCsvRowFromEntry(e, fieldName)));
  });

  rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const lines = [headerCols.join(",")];
  rows.forEach(r => lines.push(headerCols.map(col => toCsvCell(r[col] || "")).join(",")));
  return lines.join("\n") + "\n";
}

function toLogFileObject(fieldName, entries) {
  const safe = safeFieldName(fieldName);
  const years = {};

  entries.forEach(entry => {
    const year = String(entry.date || "").slice(0, 4) || "unknown";
    if (!years[year]) years[year] = { entries: [] };
    years[year].entries.push(entry);
  });

  return { field: safe, years };
}

function flattenEntries(data) {
  const years = data?.years || {};
  const out = [];

  Object.keys(years).forEach(year => {
    const entries = years[year]?.entries;
    if (!Array.isArray(entries)) return;
    entries.forEach(e => {
      if (e && typeof e === "object") out.push(e);
    });
  });

  return out;
}

function flattenEntriesCached(data) {
  if (!data || typeof data !== "object") return [];

  const cached = FLAT_ENTRIES_CACHE.get(data);
  if (cached) return cached;

  const flattened = flattenEntries(data);
  FLAT_ENTRIES_CACHE.set(data, flattened);
  return flattened;
}

function toEditableRow(entry, fields = [], beforeFingerprint = "") {
  const distributedNames = getDistributedNames(entry.distributed);
  return {
    raw: deepClone(entry),
    fields: Array.isArray(fields) ? fields : [],
    beforeFingerprint,
    date: String(entry.date || "").slice(0, 10),
    workType: String(entry.workType || distributedNames || ""),
    machine: String(entry.machine || ""),
    workersText: formatWorkersForCsv(entry.workers ?? entry.worker),
    notes: String(entry.notes || "")
  };
}

function createEmptyRow() {
  const type = getLogType();
  const base = {
    eventId: createEventId(),
    date: "",
    workType: getDefaultWorkType(type),
    machine: "",
    workers: [],
    notes: ""
  };
  return {
    raw: base,
    fields: state.loadedField ? [state.loadedField] : [],
    beforeFingerprint: "",
    date: "",
    workType: base.workType,
    machine: "",
    workersText: "",
    notes: ""
  };
}

function normalizeRow(row) {
  return {
    raw: deepClone(row.raw || {}),
    fields: Array.isArray(row.fields) ? row.fields.slice() : [],
    beforeFingerprint: String(row.beforeFingerprint || ""),
    date: String(row.date || "").trim(),
    workType: String(row.workType || "").trim(),
    machine: String(row.machine || "").trim(),
    workersText: String(row.workersText || "").trim(),
    notes: String(row.notes || "").trim()
  };
}

function isAllBlank(row) {
  return !row.date && !row.workType && !row.machine && !row.workersText && !row.notes;
}

function formatWorkersForCsv(workers) {
  if (Array.isArray(workers)) {
    return workers.map(v => String(v || "").trim()).filter(Boolean).join("／");
  }

  if (workers && typeof workers === "object") {
    return Object.values(workers).map(v => String(v || "").trim()).filter(Boolean).join("／");
  }

  return String(workers || "").trim();
}

function normalizeMachine(entry) {
  const raw = entry?.machine ?? "";
  if (Array.isArray(raw)) {
    return raw.map(v => String(v || "").trim()).filter(Boolean).join("／");
  }
  return String(raw || "").trim();
}

function normalizeMethod(entry) {
  const spray = String(entry?.sprayMethod || "").trim();
  const mowing = String(entry?.mowingMethod || "").trim();
  return spray || mowing;
}

function buildCsvRowFromEntry(entry, fieldName) {
  return {
    date: String(entry.date || "").trim(),
    eventId: String(entry.eventId || "").trim(),
    worker: formatWorkersForCsv(entry.workers ?? entry.worker),
    field: String(fieldName || "").trim(),
    machine: normalizeMachine(entry),
    workType: String(entry.workType || "").trim(),
    method: normalizeMethod(entry)
  };
}

function chooseAllCsvHeader(type, existingHeader = []) {
  const normalized = Array.isArray(existingHeader) ? existingHeader.map(v => String(v || "").trim()).filter(Boolean) : [];
  const hasCore = normalized.includes("date") && normalized.includes("worker") && normalized.includes("field");

  if (hasCore) {
    if (!normalized.includes("eventId")) normalized.push("eventId");
    if (!normalized.includes("machine")) normalized.push("machine");
    return normalized;
  }

  const richTypes = new Set(["tillage", "weeding", "hand-weeding", "watering", "intertill", "bedmaking", "field-maintenance"]);
  if (richTypes.has(type)) return ["date", "eventId", "worker", "field", "machine", "workType", "method"];
  return ["date", "eventId", "worker", "field", "machine"];
}

async function loadAllCsvRaw(type) {
  const res = await fetch(`/logs/${type}/all.csv?ts=${Date.now()}`).catch(() => null);
  if (!res || !res.ok) return { header: [], rows: [] };
  return parseAllCsvText(await res.text());
}

async function loadAllCsvPreview(type) {
  const parsed = await loadAllCsvRaw(type);
  state.allCsvHeader = parsed.header;
  state.allCsvRows = parsed.rows;
  renderAllCsvPreview();
}

function renderAllCsvPreview() {
  const header = chooseAllCsvHeader(getLogType(), state.allCsvHeader);
  const thead = document.getElementById("all-csv-head");
  const tbody = document.getElementById("all-csv-rows");
  const status = document.getElementById("all-csv-status");
  const scroll = document.getElementById("all-csv-scroll");
  if (!thead || !tbody || !status) return;

  const mode = getTargetMode();
  const targetDate = state.loadedDate || (document.getElementById("target-date")?.value || "");
  const targetField = state.loadedField;

  thead.innerHTML = `<tr>${header.map(col => `<th style="text-align:left; border-bottom:1px solid #ddd; padding:6px;">${escapeHtml(col)}</th>`).join("")}</tr>`;
  tbody.innerHTML = "";

  const rows = Array.isArray(state.allCsvRows) ? state.allCsvRows : [];
  const matched = rows.filter(r => {
    if (mode === "date") return String(r.date || "") === targetDate;
    return isCsvRowForField(r, targetField);
  });

  state.allCsvDisplayRows = matched.length > 0 ? matched : rows;
  if (scroll) scroll.scrollTop = 0;
  renderAllCsvVirtualWindow(true);

  const suffix = state.allCsvDisplayRows.length > ALLCSV_VIRTUAL_THRESHOLD ? "（仮想スクロール表示）" : "";
  const keyText = mode === "date" ? `${targetDate || "対象日"} 該当 ${matched.length}件` : `${targetField || "対象圃場"} 該当 ${matched.length}件`;
  status.textContent = `all.csv ${rows.length}件中、${keyText} ${suffix}`;
}

function renderAllCsvVirtualWindow(force = false) {
  const tbody = document.getElementById("all-csv-rows");
  const scroll = document.getElementById("all-csv-scroll");
  const header = chooseAllCsvHeader(getLogType(), state.allCsvHeader);
  if (!tbody || !scroll) return;

  const rows = Array.isArray(state.allCsvDisplayRows) ? state.allCsvDisplayRows : [];
  const rowHeight = state.allCsvVirtual.rowHeight;
  const overscan = state.allCsvVirtual.overscan;

  if (rows.length <= ALLCSV_VIRTUAL_THRESHOLD) {
    if (!force && state.allCsvVirtual.start === 0 && state.allCsvVirtual.end === rows.length) return;

    state.allCsvVirtual.start = 0;
    state.allCsvVirtual.end = rows.length;
    tbody.innerHTML = "";
    const frag = document.createDocumentFragment();
    rows.forEach(r => {
      const tr = document.createElement("tr");
      tr.style.borderBottom = "1px solid #eee";
      tr.innerHTML = header.map(col => `<td style="padding:6px;">${escapeHtml(r[col] || "")}</td>`).join("");
      frag.appendChild(tr);
    });
    tbody.appendChild(frag);
    return;
  }

  const viewportHeight = Math.max(scroll.clientHeight, rowHeight);
  const visibleCount = Math.ceil(viewportHeight / rowHeight);
  const start = Math.max(0, Math.floor(scroll.scrollTop / rowHeight) - overscan);
  const end = Math.min(rows.length, start + visibleCount + overscan * 2);

  if (!force && start === state.allCsvVirtual.start && end === state.allCsvVirtual.end) return;

  state.allCsvVirtual.start = start;
  state.allCsvVirtual.end = end;

  const topSpace = start * rowHeight;
  const bottomSpace = Math.max(0, (rows.length - end) * rowHeight);

  tbody.innerHTML = "";

  if (topSpace > 0) {
    const topTr = document.createElement("tr");
    topTr.innerHTML = `<td colspan="${header.length}" style="padding:0; border:0; height:${topSpace}px;"></td>`;
    tbody.appendChild(topTr);
  }

  const frag = document.createDocumentFragment();
  for (let i = start; i < end; i++) {
    const r = rows[i];
    const tr = document.createElement("tr");
    tr.style.borderBottom = "1px solid #eee";
    tr.style.height = `${rowHeight}px`;
    tr.innerHTML = header.map(col => `<td style="padding:6px;">${escapeHtml(r[col] || "")}</td>`).join("");
    frag.appendChild(tr);
  }
  tbody.appendChild(frag);

  if (bottomSpace > 0) {
    const bottomTr = document.createElement("tr");
    bottomTr.innerHTML = `<td colspan="${header.length}" style="padding:0; border:0; height:${bottomSpace}px;"></td>`;
    tbody.appendChild(bottomTr);
  }
}

function isCsvRowForField(row, targetField) {
  if (!targetField) return false;
  const raw = String(row?.field || "").trim();
  if (!raw) return false;

  const fields = raw.split("／").map(v => v.trim()).filter(Boolean);
  if (fields.includes(targetField)) return true;
  return raw.includes(targetField);
}

function parseAllCsvText(csvText) {
  const normalized = String(csvText || "").replace(/\r\n/g, "\n").trim();
  if (!normalized) return { header: [], rows: [] };

  const lines = normalized.split("\n").map(v => v.trim()).filter(Boolean);
  if (lines.length === 0) return { header: [], rows: [] };

  const header = parseCsvLine(lines[0]).map(v => String(v || "").trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const row = {};
    header.forEach((col, idx) => {
      row[col] = String(cols[idx] ?? "").trim();
    });
    rows.push(row);
  }

  return { header, rows };
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }

    cur += ch;
  }

  out.push(cur);
  return out;
}

function scheduleDiffPreviewRender() {
  if (state.diffRenderQueued) return;
  state.diffRenderQueued = true;
  requestAnimationFrame(() => {
    state.diffRenderQueued = false;
    renderDiffPreview();
  });
}

function renderDiffPreview() {
  const status = document.getElementById("diff-status");
  const tbody = document.getElementById("diff-rows");
  if (!status || !tbody) return;

  const diffs = computeDiffRows();
  tbody.innerHTML = "";

  const frag = document.createDocumentFragment();
  diffs.forEach(item => {
    const tr = document.createElement("tr");
    tr.innerHTML = [
      `<td>${escapeHtml(item.kindLabel)}</td>`,
      `<td>${escapeHtml(item.date)}</td>`,
      `<td>${escapeHtml(item.workType)}</td>`,
      `<td>${escapeHtml(item.worker)}</td>`,
      `<td>${escapeHtml(item.machine)}</td>`,
      `<td>${escapeHtml(item.fields)}</td>`,
      `<td>${escapeHtml(item.notes)}</td>`
    ].join("");
    frag.appendChild(tr);
  });
  tbody.appendChild(frag);

  const added = diffs.filter(v => v.kind === "add").length;
  const changed = diffs.filter(v => v.kind === "change").length;
  const deleted = diffs.filter(v => v.kind === "delete").length;

  if (diffs.length === 0) {
    status.textContent = "差分なし（保存不要）";
  } else {
    status.textContent = `差分 ${diffs.length}件（追加 ${added} / 変更 ${changed} / 削除 ${deleted}）`;
  }
}

function computeDiffRows() {
  const original = state.originalRows.map(r => normalizeRow(r));
  const current = state.rows.map(r => normalizeRow(r));

  const originalByFp = new Map();
  original.forEach(r => {
    if (r.beforeFingerprint) originalByFp.set(r.beforeFingerprint, r);
  });

  const currentFpSet = new Set();
  const diffs = [];

  current.forEach(r => {
    if (isAllBlank(r)) return;

    if (!r.beforeFingerprint) {
      diffs.push(createDiffViewRow("add", r));
      return;
    }

    currentFpSet.add(r.beforeFingerprint);
    const before = originalByFp.get(r.beforeFingerprint);
    if (!before) {
      diffs.push(createDiffViewRow("add", r));
      return;
    }

    if (buildRowComparableSignature(before) !== buildRowComparableSignature(r)) {
      diffs.push(createDiffViewRow("change", r));
    }
  });

  original.forEach(r => {
    if (!r.beforeFingerprint) return;
    if (currentFpSet.has(r.beforeFingerprint)) return;
    diffs.push(createDiffViewRow("delete", r));
  });

  return diffs;
}

function buildRowComparableSignature(row) {
  const normalized = normalizeRow(row);
  const entry = deepClone(normalized.raw || {});
  entry.date = normalized.date;
  entry.workType = normalized.workType;
  entry.machine = normalized.machine;
  entry.workers = parseWorkers(normalized.workersText);
  entry.notes = normalized.notes;
  const fields = Array.isArray(normalized.fields)
    ? normalized.fields.slice().map(v => String(v || "").trim()).filter(Boolean).sort().join("／")
    : "";

  return [
    String(entry.date || "").trim(),
    String(entry.eventId || "").trim(),
    String(entry.workType || "").trim(),
    normalizeMachine(entry),
    formatWorkersForCsv(entry.workers ?? entry.worker),
    normalizeMethod(entry),
    normalizePesticides(entry),
    getDistributedNames(entry.distributed),
    String(entry.notes || "").trim(),
    fields,
    safeStableJson(entry)
  ].join("||");
}

function safeStableJson(value) {
  try {
    return JSON.stringify(sortObjectDeep(value));
  } catch {
    return "";
  }
}

function sortObjectDeep(value) {
  if (Array.isArray(value)) return value.map(sortObjectDeep);
  if (!value || typeof value !== "object") return value;

  const out = {};
  Object.keys(value).sort().forEach(key => {
    out[key] = sortObjectDeep(value[key]);
  });
  return out;
}

function createDiffViewRow(kind, row) {
  const labels = {
    add: "追加",
    change: "変更",
    delete: "削除"
  };

  return {
    kind,
    kindLabel: labels[kind] || kind,
    date: String(row?.date || "").trim(),
    workType: String(row?.workType || "").trim(),
    worker: String(row?.workersText || "").trim(),
    machine: String(row?.machine || "").trim(),
    fields: Array.isArray(row?.fields) ? row.fields.join("／") : "",
    notes: String(row?.notes || "").trim()
  };
}

function updateRowField(row, key, value) {
  row[key] = value;
  if (!row.raw || typeof row.raw !== "object") row.raw = {};

  if (key === "workersText") {
    row.raw.workers = parseWorkers(value);
    scheduleDiffPreviewRender();
    return;
  }

  if (key === "date" || key === "workType" || key === "machine" || key === "notes") {
    row.raw[key] = value;
  }

  scheduleDiffPreviewRender();
}

function renderDynamicFieldEditor() {
  const status = document.getElementById("dynamic-field-status");
  const root = document.getElementById("dynamic-fields");
  if (!status || !root) return;

  root.innerHTML = "";

  if (state.selectedIndex == null || !state.rows[state.selectedIndex]) {
    status.textContent = "行を選択してください";
    return;
  }

  const row = state.rows[state.selectedIndex];
  const type = getLogType();
  const keys = getDynamicKeys(type, row.raw || {});

  status.textContent = `行 #${state.selectedIndex + 1} を編集中（${keys.length}項目）`;
  keys.forEach(key => {
    const value = row.raw?.[key];
    const editorType = inferEditorType(type, key, value);
    root.appendChild(createDynamicFieldNode({ type, key, value, editorType, row }));
  });
}

function getDynamicKeys(type, rawEntry) {
  const suggested = Array.isArray(TYPE_SUGGESTED_KEYS[type]) ? TYPE_SUGGESTED_KEYS[type] : [];
  const fromRaw = rawEntry && typeof rawEntry === "object" ? Object.keys(rawEntry) : [];

  const ordered = [];
  const seen = new Set();
  const push = (k) => {
    const key = String(k || "").trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    ordered.push(key);
  };

  suggested.forEach(push);
  fromRaw.forEach(push);

  if (String(rawEntry?.workType || "").trim() === "除草剤散布") {
    ["sprayMethod", "pesticides", "pesticideUsage", "distributed"].forEach(push);
  }
  if (String(rawEntry?.workType || "").trim() === "草刈り") {
    ["mowingMethod"].forEach(push);
  }

  return ordered;
}

function inferEditorType(type, key, value) {
  if (key === "date") return "date";
  if (key === "workType") return "workType";
  if (key === "workers") return "workers";
  if (key === "machine") return "machine";
  if (key === "distributed") return "distributedTable";
  if (key === "pesticideUsage") return "pesticideUsageTable";
  if (key === "sprayMethod" || key === "mowingMethod") return "method";
  if (NUMERIC_KEYS.has(key)) return "number";

  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";

  if (Array.isArray(value)) {
    const allPrimitive = value.every(v => v == null || ["string", "number", "boolean"].includes(typeof v));
    return allPrimitive ? "list" : "json";
  }

  if (value && typeof value === "object") return "json";
  return "text";
}

function createDynamicFieldNode({ type, key, value, editorType, row }) {
  const wrap = document.createElement("div");
  wrap.style.display = "grid";
  wrap.style.gap = "6px";

  const label = document.createElement("label");
  label.textContent = key;
  label.style.fontWeight = "600";
  label.style.color = "#333";
  wrap.appendChild(label);

  let input;

  if (editorType === "date") {
    input = document.createElement("input");
    input.type = "date";
    input.className = "form-input";
    input.value = String(value || "").slice(0, 10);
    input.addEventListener("input", () => setDynamicValue(row, key, input.value, editorType));
  } else if (editorType === "number") {
    input = document.createElement("input");
    input.type = "number";
    input.step = "any";
    input.className = "form-input";
    input.value = value == null || value === "" ? "" : String(value);
    input.addEventListener("input", () => setDynamicValue(row, key, input.value, editorType));
  } else if (editorType === "boolean") {
    input = createSelectInput(["", "true", "false"], value === true ? "true" : value === false ? "false" : "");
    input.addEventListener("change", () => setDynamicValue(row, key, input.value, editorType));
  } else if (editorType === "workType") {
    input = createSelectInput(getWorkTypeOptions(type, value), String(value || ""));
    input.addEventListener("change", () => {
      setDynamicValue(row, key, input.value, editorType);
      renderRows();
      renderDynamicFieldEditor();
    });
  } else if (editorType === "machine") {
    input = createSelectInput(getMachineOptions(type, value), String(value || ""));
    input.addEventListener("change", () => setDynamicValue(row, key, input.value, editorType));
  } else if (editorType === "method") {
    input = createSelectInput(getMethodOptions(key, value), String(value || ""));
    input.addEventListener("change", () => setDynamicValue(row, key, input.value, editorType));
  } else if (editorType === "distributedTable") {
    input = createDistributedTableEditor(row, key);
  } else if (editorType === "pesticideUsageTable") {
    input = createPesticideUsageTableEditor(row, key);
  } else if (editorType === "workers") {
    input = document.createElement("textarea");
    input.className = "form-input";
    input.rows = 3;
    input.value = Array.isArray(value)
      ? value.map(v => String(v || "").trim()).filter(Boolean).join("\n")
      : String(value || "").split(/[\/,／、]/).map(v => v.trim()).filter(Boolean).join("\n");
    input.placeholder = "1行1名（または / 区切り）";
    input.addEventListener("input", () => setDynamicValue(row, key, input.value, editorType));
  } else if (editorType === "list") {
    input = document.createElement("textarea");
    input.className = "form-input";
    input.rows = 4;
    input.value = Array.isArray(value) ? value.map(v => String(v ?? "")).join("\n") : "";
    input.placeholder = "1行に1要素";
    input.addEventListener("input", () => setDynamicValue(row, key, input.value, editorType));
  } else if (editorType === "json") {
    input = document.createElement("textarea");
    input.className = "form-input";
    input.rows = 8;
    input.style.fontFamily = "monospace";
    input.value = value == null ? "" : JSON.stringify(value, null, 2);
    input.placeholder = "JSONを入力";
    input.addEventListener("blur", () => {
      const ok = setDynamicValue(row, key, input.value, editorType);
      input.style.borderColor = ok ? "" : "#c0392b";
    });
  } else {
    input = document.createElement("input");
    input.type = "text";
    input.className = "form-input";
    input.value = value == null ? "" : String(value);
    input.addEventListener("input", () => setDynamicValue(row, key, input.value, editorType));
  }

  wrap.appendChild(input);
  return wrap;
}

function createDistributedTableEditor(row, key) {
  const columns = [
    { key: "field", label: "field" },
    { key: "pesticide_id", label: "pesticide_id" },
    { key: "name", label: "name" },
    { key: "dilution_rate", label: "dilution_rate", numeric: true },
    { key: "unit", label: "unit" },
    { key: "water_unit", label: "water_unit" },
    { key: "water_amount", label: "water_amount", numeric: true },
    { key: "spray_amount", label: "spray_amount", numeric: true },
    { key: "pesticide_amount", label: "pesticide_amount", numeric: true },
    { key: "pesticide_unit", label: "pesticide_unit" }
  ];
  return createObjectArrayTableEditor(row, key, columns);
}

function createPesticideUsageTableEditor(row, key) {
  const columns = [
    { key: "pesticide_id", label: "pesticide_id" },
    { key: "name", label: "name" },
    { key: "dilution_rate", label: "dilution_rate", numeric: true },
    { key: "total_water_amount", label: "total_water_amount", numeric: true },
    { key: "total_spray_amount", label: "total_spray_amount", numeric: true },
    { key: "unit", label: "unit" }
  ];
  return createObjectArrayTableEditor(row, key, columns);
}

function createObjectArrayTableEditor(row, key, columns) {
  if (!Array.isArray(row.raw[key])) {
    row.raw[key] = [];
  }

  const root = document.createElement("div");
  root.style.display = "grid";
  root.style.gap = "8px";
  const rowsWrap = document.createElement("div");
  rowsWrap.style.display = "grid";
  rowsWrap.style.gap = "8px";

  row.raw[key].forEach((item, idx) => {
    const rowCard = document.createElement("div");
    rowCard.style.border = "1px solid #ddd";
    rowCard.style.borderRadius = "8px";
    rowCard.style.padding = "10px";
    rowCard.style.display = "grid";
    rowCard.style.gap = "8px";

    const grid = document.createElement("div");
    grid.style.display = "grid";
    grid.style.gap = "8px";
    grid.style.gridTemplateColumns = "repeat(auto-fit, minmax(160px, 1fr))";

    columns.forEach(col => {
      const fieldWrap = document.createElement("div");
      fieldWrap.style.display = "grid";
      fieldWrap.style.gap = "4px";

      const fieldLabel = document.createElement("label");
      fieldLabel.textContent = col.label;
      fieldLabel.style.fontSize = "12px";
      fieldLabel.style.color = "#555";

      const input = document.createElement("input");
      input.className = "form-input";
      input.type = col.numeric ? "number" : "text";
      if (col.numeric) input.step = "any";
      input.value = item?.[col.key] == null ? "" : String(item[col.key]);
      input.addEventListener("input", () => {
        const next = col.numeric
          ? (String(input.value || "").trim() === "" ? "" : Number(input.value))
          : input.value;
        if (!row.raw[key][idx] || typeof row.raw[key][idx] !== "object") row.raw[key][idx] = {};
        row.raw[key][idx][col.key] = next;
        applyRawToDisplayFields(row);
        syncSelectedRowInputs();
        scheduleDiffPreviewRender();
      });

      fieldWrap.appendChild(fieldLabel);
      fieldWrap.appendChild(input);
      grid.appendChild(fieldWrap);
    });

    rowCard.appendChild(grid);

    const actionWrap = document.createElement("div");
    actionWrap.style.display = "flex";
    actionWrap.style.justifyContent = "flex-end";
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "secondary-btn";
    delBtn.textContent = "削除";
    delBtn.addEventListener("click", () => {
      row.raw[key].splice(idx, 1);
      renderDynamicFieldEditor();
      applyRawToDisplayFields(row);
      renderRows();
      scheduleDiffPreviewRender();
    });
    actionWrap.appendChild(delBtn);
    rowCard.appendChild(actionWrap);

    rowsWrap.appendChild(rowCard);
  });

  root.appendChild(rowsWrap);

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "secondary-btn";
  addBtn.textContent = "行を追加";
  addBtn.addEventListener("click", () => {
    const obj = {};
    columns.forEach(c => { obj[c.key] = ""; });
    row.raw[key].push(obj);
    renderDynamicFieldEditor();
    applyRawToDisplayFields(row);
    renderRows();
    scheduleDiffPreviewRender();
  });
  root.appendChild(addBtn);

  return root;
}

function createSelectInput(options, selected) {
  const sel = document.createElement("select");
  sel.className = "form-input";

  const normalized = Array.from(new Set(["", ...(options || []), selected || ""]))
    .map(v => String(v || "").trim())
    .filter((v, i, arr) => v || i === arr.indexOf(""));

  sel.innerHTML = normalized.map(v => `<option value="${escapeAttr(v)}">${escapeHtml(v)}</option>`).join("");
  sel.value = selected || "";
  return sel;
}

function getMachineOptions(type, currentValue) {
  const pageId = TYPE_TO_MACHINE_PAGE_ID[type] || "";
  const filtered = state.machines.filter(m => {
    const allowed = Array.isArray(m.allowedPageIds) ? m.allowedPageIds : [];
    if (!pageId) return true;
    if (!allowed.length) return true;
    return allowed.includes(pageId);
  });

  const ids = filtered.map(m => String(m.id || "").trim()).filter(Boolean);
  if (currentValue && !ids.includes(String(currentValue))) ids.push(String(currentValue));
  return ids;
}

function getMethodOptions(key, currentValue) {
  let options = [];

  if (key === "sprayMethod") {
    const src = state.attachmentIndex.weedingSpray || state.attachmentIndex.weeding_spray || state.attachmentIndex.spray;
    options = normalizeStringList(src, DEFAULT_SPRAY_METHODS);
  } else if (key === "mowingMethod") {
    options = normalizeStringList(state.attachmentIndex.weeding, DEFAULT_MOWING_METHODS);
  }

  if (currentValue && !options.includes(String(currentValue))) options.push(String(currentValue));
  return options;
}

function getWorkTypeOptions(type, currentValue) {
  const base = Array.isArray(WORKTYPE_OPTIONS[type]) ? WORKTYPE_OPTIONS[type].slice() : [];
  if (currentValue && !base.includes(String(currentValue))) base.push(String(currentValue));
  return base;
}

function normalizeStringList(value, fallback) {
  if (!Array.isArray(value)) return fallback.slice();
  const list = value.map(v => String(v || "").trim()).filter(Boolean);
  return list.length ? Array.from(new Set(list)) : fallback.slice();
}

function setDynamicValue(row, key, inputValue, editorType) {
  if (!row.raw || typeof row.raw !== "object") row.raw = {};

  try {
    if (editorType === "number") {
      row.raw[key] = String(inputValue || "").trim() === "" ? "" : Number(inputValue);
    } else if (editorType === "boolean") {
      row.raw[key] = inputValue === "true" ? true : inputValue === "false" ? false : "";
    } else if (editorType === "workers") {
      row.raw[key] = parseWorkers(inputValue);
    } else if (editorType === "list") {
      row.raw[key] = String(inputValue || "").split("\n").map(v => v.trim()).filter(Boolean);
    } else if (editorType === "json") {
      const text = String(inputValue || "").trim();
      row.raw[key] = text ? JSON.parse(text) : (Array.isArray(row.raw[key]) ? [] : {});
    } else {
      row.raw[key] = inputValue;
    }
  } catch {
    return false;
  }

  applyRawToDisplayFields(row);
  syncSelectedRowInputs();
  scheduleDiffPreviewRender();
  return true;
}

function syncSelectedRowInputs() {
  const idx = state.selectedIndex;
  if (idx == null || !state.rows[idx]) return;

  const tr = document.querySelector(`#edit-rows tr[data-index="${idx}"]`);
  if (!tr) return;

  const row = state.rows[idx];

  const fieldsCell = tr.querySelector("td[data-col='fields']");
  if (fieldsCell) fieldsCell.textContent = (row.fields || []).join("／");

  const dateInput = tr.querySelector("input[data-key='date']");
  if (dateInput && dateInput.value !== (row.date || "")) dateInput.value = row.date || "";

  const workTypeInput = tr.querySelector("input[data-key='workType']");
  if (workTypeInput && workTypeInput.value !== (row.workType || "")) workTypeInput.value = row.workType || "";

  const machineInput = tr.querySelector("input[data-key='machine']");
  if (machineInput && machineInput.value !== (row.machine || "")) machineInput.value = row.machine || "";

  const workersInput = tr.querySelector("input[data-key='workersText']");
  if (workersInput && workersInput.value !== (row.workersText || "")) workersInput.value = row.workersText || "";

  const notesInput = tr.querySelector("input[data-key='notes']");
  if (notesInput && notesInput.value !== (row.notes || "")) notesInput.value = row.notes || "";
}

function applyRawToDisplayFields(row) {
  row.date = String(row.raw?.date || "").slice(0, 10);
  row.workType = String(row.raw?.workType || getDistributedNames(row.raw?.distributed) || "");
  row.machine = normalizeMachine(row.raw);
  row.workersText = formatWorkersForCsv(row.raw?.workers ?? row.raw?.worker);
  row.notes = String(row.raw?.notes || "");
}

function buildEntryFromRow(row) {
  const base = deepClone(row.raw || {});
  base.eventId = ensureEntryEventId(base);
  base.date = row.date;
  base.workType = row.workType;
  base.machine = row.machine;
  base.workers = parseWorkers(row.workersText);
  base.notes = row.notes;
  return base;
}

function isSyncRelatedEnabled() {
  return !!document.getElementById("sync-related")?.checked;
}

async function applyRelatedUpdates(type, loadedField, rowUpdates) {
  const updateMap = new Map();
  rowUpdates.forEach(u => {
    if (u.beforeFingerprint) updateMap.set(u.beforeFingerprint, u.afterEntry);
  });

  const overrides = {};
  let updatedCount = 0;

  const processed = await Promise.all(
    state.fields
      .filter(fieldName => fieldName !== loadedField)
      .map(async fieldName => {
        const safe = safeFieldName(fieldName);
        const data = await loadJSON(`/logs/${type}/${safe}.json`).catch(() => null);
        if (!data?.years || typeof data.years !== "object") return null;

        let changed = false;
        let updatedLocal = 0;

        Object.keys(data.years).forEach(year => {
          const list = data.years[year]?.entries;
          if (!Array.isArray(list)) return;

          for (let i = 0; i < list.length; i++) {
            const current = list[i];
            const fp = createEntryFingerprint(current);
            if (!updateMap.has(fp)) continue;

            list[i] = mergeEntryForRelatedField(current, updateMap.get(fp));
            changed = true;
            updatedLocal += 1;
          }
        });

        if (!changed) return null;
        return { safe, data, updatedLocal };
      })
  );

  processed.forEach(item => {
    if (!item) return;
    overrides[item.safe] = item.data;
    updatedCount += item.updatedLocal;
  });

  return { overrides, updatedCount };
}

function createEntryFingerprint(entry) {
  if (!entry || typeof entry !== "object") return "";

  return [
    String(entry.eventId || "").trim(),
    String(entry.date || "").trim(),
    String(entry.workType || "").trim(),
    normalizeMachine(entry),
    normalizeWorkers(entry),
    normalizeMethod(entry),
    normalizePesticides(entry),
    String(entry.notes || "").trim()
  ].join("||");
}

function supplementMissingEventIdsInLogData(data) {
  if (!data?.years || typeof data.years !== "object") return false;

  let changed = false;
  Object.keys(data.years).forEach(year => {
    const entries = data.years[year]?.entries;
    if (!Array.isArray(entries)) return;

    entries.forEach(entry => {
      if (!entry || typeof entry !== "object") return;
      const nextId = ensureEntryEventId(entry);
      if (entry.eventId !== nextId) {
        entry.eventId = nextId;
        changed = true;
      }
    });
  });

  return changed;
}

function ensureEntryEventId(entry) {
  const existing = String(entry?.eventId || "").trim();
  if (existing) return existing;
  return createEventId();
}

function createEventId() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `ev-${ts}-${rand}`;
}

function normalizeWorkers(entry) {
  const raw = entry?.workers ?? entry?.worker ?? "";
  if (Array.isArray(raw)) {
    return raw.map(v => String(v || "").trim()).filter(Boolean).join("／");
  }

  return String(raw || "")
    .split(/[\/,／、]/)
    .map(v => v.trim())
    .filter(Boolean)
    .join("／");
}

function normalizePesticides(entry) {
  const list = Array.isArray(entry?.pesticides) ? entry.pesticides : [];
  return list.map(v => String(v || "").trim()).filter(Boolean).sort().join("|");
}

function mergeEntryForRelatedField(sourceEntry, templateEntry) {
  const merged = deepClone(templateEntry || {});
  if (Array.isArray(sourceEntry?.distributed)) {
    // distributed は圃場ごとに量が異なるため、同時修正では維持する。
    merged.distributed = deepClone(sourceEntry.distributed);
  }
  return merged;
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj ?? null));
}

function getDefaultWorkType(type) {
  const arr = WORKTYPE_OPTIONS[type] || [];
  return arr[0] || "";
}

function parseWorkers(text) {
  return String(text || "")
    .split(/[\n\/,／、]/)
    .map(v => v.trim())
    .filter(Boolean);
}

function getDistributedNames(distributed) {
  if (!Array.isArray(distributed)) return "";

  const names = Array.from(new Set(
    distributed
      .map(d => String(d?.name || "").trim())
      .filter(Boolean)
  ));

  return names.join("、");
}

function toCsvCell(value) {
  const s = String(value ?? "");
  if (!/[",\n\r]/.test(s)) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

function getLogType() {
  return document.getElementById("log-type")?.value || "";
}

function getTargetMode() {
  return document.querySelector("input[name='target-mode']:checked")?.value || "field";
}

function setStatus(text) {
  const el = document.getElementById("status");
  if (el) el.textContent = text;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}
