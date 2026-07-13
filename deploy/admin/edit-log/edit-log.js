import { loadJSON } from "/common/json.js?v=1";
import { saveLog } from "/common/save/index.js?v=1";
import { safeFieldName } from "/common/utils.js?v=1";
import { rebuildMonthlyWorkSummary } from "/common/monthly-work-summary.js?v=1";
import { openFieldModal } from "/common/filter/filter-field.js?v=1";

let state = {
  fields: [],
  rows: [],
  originalRows: [],
  selectedIndex: null,
  loadedField: "",
  loadedDate: "",
  allCsvHeader: [],
  allCsvRows: [],
  machines: [],
  attachmentIndex: {}
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

export async function initEditLogPage() {
  await loadMasterData();
  bindEvents();

  const dateEl = document.getElementById("target-date");
  if (dateEl) dateEl.value = new Date().toISOString().slice(0, 10);

  updateTargetFieldLabel();
  updateTargetModeUI();
  updateActionAvailability();
  renderDynamicFieldEditor();
  setStatus("ログタイプと編集対象を選んで読み込んでください。");
}

async function loadMasterData() {
  const fields = await loadJSON("/data/fields.json").catch(() => []);
  state.fields = Array.isArray(fields) ? fields.map(f => f.name).filter(Boolean) : [];

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
      state.selectedIndex = state.rows.length - 1;
      renderRows();
      renderDynamicFieldEditor();
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
      state.selectedIndex = null;
      renderRows();
      renderDynamicFieldEditor();
    };
  }

  const saveBtn = document.getElementById("save-btn");
  if (saveBtn) saveBtn.onclick = () => saveCurrentLog();

  const pickFieldBtn = document.getElementById("pick-field-btn");
  if (pickFieldBtn) {
    pickFieldBtn.onclick = () => {
      openFieldModal({
        mode: "select",
        includeExpired: true,
        onSelect: (name) => {
          state.loadedField = name;
          updateTargetFieldLabel();
        }
      });
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
    });
  }
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
  const sync = document.getElementById("sync-related");

  if (addBtn) {
    addBtn.disabled = mode === "date";
    addBtn.title = mode === "date" ? "日付モードは既存ログ同時修正のため行追加不可" : "";
  }

  if (sync) {
    sync.disabled = mode === "date";
    if (mode === "date") sync.checked = false;
  }
}

async function loadSelectedLog() {
  const type = getLogType();
  if (!type) {
    alert("ログタイプを選択してください");
    return;
  }

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

  const rows = flattenEntries(data)
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
    .map(e => toEditableRow(e, [field], createEntryFingerprint(e)));

  state.rows = rows;
  state.originalRows = deepClone(rows);
  state.loadedDate = "";
  state.selectedIndex = null;

  renderRows();
  renderDynamicFieldEditor();
  await loadAllCsvPreview(type);
  setStatus(`${field} / ${type} を読み込みました（${rows.length}件）`);
}

async function loadByDate(type, date) {
  const groups = new Map();

  for (const fieldName of state.fields) {
    const safe = safeFieldName(fieldName);
    const data = await loadJSON(`/logs/${type}/${safe}.json`).catch(() => null);
    if (!data) continue;

    const entries = flattenEntries(data).filter(e => String(e.date || "").slice(0, 10) === date);
    entries.forEach(entry => {
      const fp = createEntryFingerprint(entry);
      if (!groups.has(fp)) {
        groups.set(fp, { raw: deepClone(entry), fields: [], beforeFingerprint: fp });
      }
      const g = groups.get(fp);
      if (!g.fields.includes(fieldName)) g.fields.push(fieldName);
    });
  }

  const rows = Array.from(groups.values())
    .map(g => toEditableRow(g.raw, g.fields.slice().sort((a, b) => a.localeCompare(b)), g.beforeFingerprint))
    .sort((a, b) => String(a.workType || "").localeCompare(String(b.workType || "")));

  state.rows = rows;
  state.originalRows = deepClone(rows);
  state.loadedDate = date;
  state.selectedIndex = null;

  renderRows();
  renderDynamicFieldEditor();
  await loadAllCsvPreview(type);

  const fieldsCount = new Set(rows.flatMap(r => r.fields)).size;
  setStatus(`${date} / ${type} を読み込みました（${rows.length}件, ${fieldsCount}圃場）`);
}

function renderRows() {
  const tbody = document.getElementById("edit-rows");
  if (!tbody) return;

  tbody.innerHTML = "";

  state.rows.forEach((row, idx) => {
    const tr = document.createElement("tr");
    tr.dataset.index = String(idx);
    tr.style.borderBottom = "1px solid #eee";
    tr.style.background = state.selectedIndex === idx ? "#f5faff" : "transparent";

    tr.innerHTML = `
      <td style="padding:6px;">${idx + 1}</td>
      <td style="padding:6px; color:#333;">${escapeHtml((row.fields || []).join("／"))}</td>
      <td style="padding:6px;"><input data-key="date" type="date" class="form-input" value="${escapeAttr(row.date)}"></td>
      <td style="padding:6px;"><input data-key="workType" type="text" class="form-input" value="${escapeAttr(row.workType)}"></td>
      <td style="padding:6px;"><input data-key="machine" type="text" class="form-input" value="${escapeAttr(row.machine)}"></td>
      <td style="padding:6px;"><input data-key="workersText" type="text" class="form-input" value="${escapeAttr(row.workersText)}"></td>
      <td style="padding:6px;"><input data-key="notes" type="text" class="form-input" value="${escapeAttr(row.notes)}"></td>
    `;

    tr.addEventListener("click", () => {
      state.selectedIndex = idx;
      renderRows();
      renderDynamicFieldEditor();
    });

    tr.querySelectorAll("input").forEach(input => {
      input.addEventListener("input", () => {
        const key = input.dataset.key;
        if (!key) return;
        updateRowField(state.rows[idx], key, input.value);
        if (state.selectedIndex === idx) {
          renderDynamicFieldEditor();
        }
      });

      input.addEventListener("click", ev => {
        ev.stopPropagation();
        state.selectedIndex = idx;
        renderDynamicFieldEditor();
      });
    });

    tbody.appendChild(tr);
  });
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

  for (const fieldName of state.fields) {
    const safe = safeFieldName(fieldName);
    const data = await loadJSON(`/logs/${type}/${safe}.json`).catch(() => null);
    if (!data?.years || typeof data.years !== "object") continue;

    let changed = false;

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
          touched += 1;
          return;
        }

        next.push(entry);
      });

      data.years[year].entries = next;
    });

    if (changed) fieldOverrides[safe] = data;
  }

  if (Object.keys(fieldOverrides).length === 0) {
    alert("更新対象がありませんでした");
    return;
  }

  await saveWithCsvRebuild(type, fieldOverrides);
  await loadByDate(type, date);
  setStatus(`保存しました: ${date} / ${type}（更新 ${touched}件）`);
}

async function saveWithCsvRebuild(type, fieldOverrides) {
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
}

async function rebuildAllCsv(type, fieldOverrides = {}) {
  const existingCsv = await loadAllCsvRaw(type);
  const headerCols = chooseAllCsvHeader(type, existingCsv.header);
  const rows = [];

  for (const fieldName of state.fields) {
    const safe = safeFieldName(fieldName);
    const override = fieldOverrides[safe] || null;
    const data = override || await loadJSON(`/logs/${type}/${safe}.json`).catch(() => null);
    if (!data) continue;

    flattenEntries(data).forEach(e => rows.push(buildCsvRowFromEntry(e, fieldName)));
  }

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
  const base = { date: "", workType: getDefaultWorkType(type), machine: "", workers: [], notes: "" };
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
    if (!normalized.includes("machine")) normalized.push("machine");
    return normalized;
  }

  const richTypes = new Set(["tillage", "weeding", "hand-weeding", "watering", "intertill", "bedmaking", "field-maintenance"]);
  if (richTypes.has(type)) return ["date", "worker", "field", "machine", "workType", "method"];
  return ["date", "worker", "field", "machine"];
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

  const displayRows = matched.length > 0 ? matched : rows;
  const maxRows = 300;

  displayRows.slice(0, maxRows).forEach(r => {
    const tr = document.createElement("tr");
    tr.style.borderBottom = "1px solid #eee";
    tr.innerHTML = header.map(col => `<td style="padding:6px;">${escapeHtml(r[col] || "")}</td>`).join("");
    tbody.appendChild(tr);
  });

  const suffix = displayRows.length > maxRows ? `（先頭${maxRows}件を表示）` : "";
  const keyText = mode === "date" ? `${targetDate || "対象日"} 該当 ${matched.length}件` : `${targetField || "対象圃場"} 該当 ${matched.length}件`;
  status.textContent = `all.csv ${rows.length}件中、${keyText} ${suffix}`;
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

function updateRowField(row, key, value) {
  row[key] = value;
  if (!row.raw || typeof row.raw !== "object") row.raw = {};

  if (key === "workersText") {
    row.raw.workers = parseWorkers(value);
    return;
  }

  if (key === "date" || key === "workType" || key === "machine" || key === "notes") {
    row.raw[key] = value;
  }
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

  const tableWrap = document.createElement("div");
  tableWrap.style.overflowX = "auto";

  const table = document.createElement("table");
  table.style.width = "100%";
  table.style.borderCollapse = "collapse";
  table.style.minWidth = "860px";

  const thead = document.createElement("thead");
  thead.innerHTML = `<tr>${columns.map(c => `<th style="text-align:left; border-bottom:1px solid #ddd; padding:6px;">${escapeHtml(c.label)}</th>`).join("")}<th style="text-align:left; border-bottom:1px solid #ddd; padding:6px; width:70px;">操作</th></tr>`;
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  row.raw[key].forEach((item, idx) => {
    const tr = document.createElement("tr");
    tr.style.borderBottom = "1px solid #eee";

    columns.forEach(col => {
      const td = document.createElement("td");
      td.style.padding = "6px";

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
      });

      td.appendChild(input);
      tr.appendChild(td);
    });

    const actionTd = document.createElement("td");
    actionTd.style.padding = "6px";
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "secondary-btn";
    delBtn.textContent = "削除";
    delBtn.addEventListener("click", () => {
      row.raw[key].splice(idx, 1);
      renderDynamicFieldEditor();
      applyRawToDisplayFields(row);
      renderRows();
    });
    actionTd.appendChild(delBtn);
    tr.appendChild(actionTd);

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  tableWrap.appendChild(table);
  root.appendChild(tableWrap);

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
  renderRows();
  return true;
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

  for (const fieldName of state.fields) {
    if (fieldName === loadedField) continue;

    const safe = safeFieldName(fieldName);
    const data = await loadJSON(`/logs/${type}/${safe}.json`).catch(() => null);
    if (!data?.years || typeof data.years !== "object") continue;

    let changed = false;

    Object.keys(data.years).forEach(year => {
      const list = data.years[year]?.entries;
      if (!Array.isArray(list)) return;

      for (let i = 0; i < list.length; i++) {
        const current = list[i];
        const fp = createEntryFingerprint(current);
        if (!updateMap.has(fp)) continue;

        list[i] = mergeEntryForRelatedField(current, updateMap.get(fp));
        changed = true;
        updatedCount += 1;
      }
    });

    if (changed) overrides[safe] = data;
  }

  return { overrides, updatedCount };
}

function createEntryFingerprint(entry) {
  if (!entry || typeof entry !== "object") return "";

  return [
    String(entry.date || "").trim(),
    String(entry.workType || "").trim(),
    normalizeMachine(entry),
    normalizeWorkers(entry),
    normalizeMethod(entry),
    normalizePesticides(entry),
    String(entry.notes || "").trim()
  ].join("||");
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
