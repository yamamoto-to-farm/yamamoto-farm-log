import { loadJSON } from "/common/json.js?v=1";
import { saveLog } from "/common/save/index.js?v=1";
import { safeFieldName } from "/common/utils.js?v=1";
import { rebuildMonthlyWorkSummary } from "/common/monthly-work-summary.js?v=1";

let state = {
  fields: [],
  rows: [],
  selectedIndex: null,
  loadedType: "",
  loadedField: "",
  allCsvHeader: [],
  allCsvRows: []
};

export async function initEditLogPage() {
  await loadFieldOptions();
  bindEvents();
  setStatus("ログタイプと圃場を選んで読み込んでください。");
}

async function loadFieldOptions() {
  const select = document.getElementById("target-field");
  if (!select) return;

  const fields = await loadJSON("/data/fields.json").catch(() => []);
  state.fields = Array.isArray(fields) ? fields.map(f => f.name).filter(Boolean) : [];

  select.innerHTML = state.fields
    .map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)
    .join("");
}

function bindEvents() {
  const loadBtn = document.getElementById("load-btn");
  if (loadBtn) loadBtn.onclick = () => loadSelectedLog();

  const addBtn = document.getElementById("add-row-btn");
  if (addBtn) addBtn.onclick = () => {
    state.rows.push(createEmptyRow());
    renderRows();
  };

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
    };
  }

  const saveBtn = document.getElementById("save-btn");
  if (saveBtn) saveBtn.onclick = () => saveCurrentLog();

  const applyRawBtn = document.getElementById("apply-raw-json-btn");
  if (applyRawBtn) applyRawBtn.onclick = () => applyRawJsonToSelectedRow();
}

async function loadSelectedLog() {
  const type = getLogType();
  const field = getTargetField();
  const safe = safeFieldName(field);

  const path = `/logs/${type}/${safe}.json`;
  const data = await loadJSON(path).catch(() => ({ field: safe, years: {} }));

  const entries = flattenEntries(data)
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
    .map(e => toEditableRow(e));

  state.rows = entries;
  state.loadedType = type;
  state.loadedField = field;
  state.selectedIndex = null;

  renderRows();
  syncRawJsonEditor();
  await loadAllCsvPreview(type, field);
  setStatus(`${field} / ${type} を読み込みました（${entries.length}件）`);
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
      <td style="padding:6px;"><input data-key="date" type="date" class="form-input" value="${escapeAttr(row.date)}"></td>
      <td style="padding:6px;"><input data-key="workType" type="text" class="form-input" value="${escapeAttr(row.workType)}"></td>
      <td style="padding:6px;"><input data-key="machine" type="text" class="form-input" value="${escapeAttr(row.machine)}"></td>
      <td style="padding:6px;"><input data-key="workersText" type="text" class="form-input" value="${escapeAttr(row.workersText)}"></td>
      <td style="padding:6px;"><input data-key="notes" type="text" class="form-input" value="${escapeAttr(row.notes)}"></td>
    `;

    tr.addEventListener("click", () => {
      state.selectedIndex = idx;
      renderRows();
      syncRawJsonEditor();
    });

    tr.querySelectorAll("input").forEach(input => {
      input.addEventListener("input", () => {
        const key = input.dataset.key;
        if (!key) return;
        updateRowField(state.rows[idx], key, input.value);
        if (state.selectedIndex === idx) {
          syncRawJsonEditor();
        }
      });

      input.addEventListener("click", ev => {
        ev.stopPropagation();
        state.selectedIndex = idx;
        syncRawJsonEditor();
      });
    });

    tbody.appendChild(tr);
  });
}

async function saveCurrentLog() {
  const type = getLogType();
  const field = getTargetField();

  if (!type || !field) {
    alert("ログタイプと圃場を選択してください");
    return;
  }

  const normalizedRows = state.rows
    .map(r => normalizeRow(r))
    .filter(r => !(isAllBlank(r)));

  if (normalizedRows.some(r => !r.date)) {
    alert("日付が空の行があります");
    return;
  }

  const rowUpdates = normalizedRows.map(r => {
    const afterEntry = buildEntryFromRow(r);
    return {
      beforeFingerprint: createEntryFingerprint(r.raw),
      afterEntry
    };
  });

  const fileObj = toLogFileObject(field, rowUpdates.map(v => v.afterEntry));
  const safe = safeFieldName(field);
  const fieldOverrides = {
    [safe]: fileObj
  };

  let linkedUpdatedCount = 0;
  if (isSyncRelatedEnabled()) {
    const related = await applyRelatedUpdates(type, field, rowUpdates);
    Object.assign(fieldOverrides, related.overrides);
    linkedUpdatedCount = related.updatedCount;
  }

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

  await saveLog({
    type: "multi",
    files
  });

  await rebuildMonthlyWorkSummary().catch(e => {
    console.warn("[edit-log] monthly work summary rebuild failed:", e);
  });

  state.loadedType = type;
  state.loadedField = field;
  await loadAllCsvPreview(type, field);
  setStatus(`保存しました: ${field} / ${type}（${normalizedRows.length}件, 同時修正 ${linkedUpdatedCount}件）`);
}

async function rebuildAllCsv(type, fieldOverrides = {}) {
  const existingCsv = await loadAllCsvRaw(type);
  const headerCols = chooseAllCsvHeader(type, existingCsv.header);
  const fieldNames = state.fields || [];
  const rows = [];

  for (const fieldName of fieldNames) {
    const safe = safeFieldName(fieldName);
    const override = fieldOverrides[safe] || null;
    const data = override || await loadJSON(`/logs/${type}/${safe}.json`).catch(() => null);
    if (!data) continue;

    const entries = flattenEntries(data);
    entries.forEach(e => {
      rows.push(buildCsvRowFromEntry(e, fieldName));
    });
  }

  rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const lines = [headerCols.join(",")];
  rows.forEach(r => {
    lines.push(headerCols.map(col => toCsvCell(r[col] || "")).join(","));
  });

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

  return {
    field: safe,
    years
  };
}

function flattenEntries(data) {
  const years = data?.years || {};
  const out = [];

  Object.keys(years).forEach(year => {
    const entries = years[year]?.entries;
    if (!Array.isArray(entries)) return;

    entries.forEach(e => {
      if (!e || typeof e !== "object") return;
      out.push(e);
    });
  });

  return out;
}

function toEditableRow(entry) {
  const distributedNames = getDistributedNames(entry.distributed);

  return {
    raw: deepClone(entry),
    date: String(entry.date || "").slice(0, 10),
    workType: String(entry.workType || distributedNames || ""),
    machine: String(entry.machine || ""),
    workersText: formatWorkersForCsv(entry.workers),
    notes: String(entry.notes || "")
  };
}

function createEmptyRow() {
  return {
    raw: {},
    date: "",
    workType: "",
    machine: "",
    workersText: "",
    notes: ""
  };
}

function normalizeRow(row) {
  return {
    raw: deepClone(row.raw || {}),
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
    return workers
      .map(v => String(v || "").trim())
      .filter(Boolean)
      .join("／");
  }

  if (workers && typeof workers === "object") {
    return Object.values(workers)
      .map(v => String(v || "").trim())
      .filter(Boolean)
      .join("／");
  }

  return String(workers || "").trim();
}

function normalizeMethod(entry) {
  if (!entry) return "";
  const spray = String(entry.sprayMethod || "").trim();
  const mowing = String(entry.mowingMethod || "").trim();
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

function normalizeMachine(entry) {
  if (!entry) return "";
  const raw = entry.machine ?? "";
  if (Array.isArray(raw)) {
    return raw.map(v => String(v || "").trim()).filter(Boolean).join("／");
  }
  return String(raw || "").trim();
}

function chooseAllCsvHeader(type, existingHeader = []) {
  const normalized = Array.isArray(existingHeader)
    ? existingHeader.map(v => String(v || "").trim()).filter(Boolean)
    : [];

  const hasCore = normalized.includes("date") && normalized.includes("worker") && normalized.includes("field");
  if (hasCore) {
    if (!normalized.includes("machine")) normalized.push("machine");
    return normalized;
  }

  const richTypes = new Set(["tillage", "weeding", "hand-weeding", "watering", "intertill", "bedmaking", "field-maintenance"]);
  if (richTypes.has(type)) {
    return ["date", "worker", "field", "machine", "workType", "method"];
  }

  return ["date", "worker", "field", "machine"];
}

async function loadAllCsvRaw(type) {
  const path = `/logs/${type}/all.csv?ts=${Date.now()}`;
  const res = await fetch(path).catch(() => null);
  if (!res || !res.ok) {
    return { header: [], rows: [] };
  }
  const text = await res.text();
  return parseAllCsvText(text);
}

async function loadAllCsvPreview(type, field) {
  const parsed = await loadAllCsvRaw(type);
  state.allCsvHeader = parsed.header;
  state.allCsvRows = parsed.rows;
  renderAllCsvPreview(field);
}

function renderAllCsvPreview(targetField) {
  const header = chooseAllCsvHeader(getLogType(), state.allCsvHeader);
  const thead = document.getElementById("all-csv-head");
  const tbody = document.getElementById("all-csv-rows");
  const status = document.getElementById("all-csv-status");
  if (!thead || !tbody || !status) return;

  thead.innerHTML = `<tr>${header.map(col => `<th style="text-align:left; border-bottom:1px solid #ddd; padding:6px;">${escapeHtml(col)}</th>`).join("")}</tr>`;
  tbody.innerHTML = "";

  const rows = Array.isArray(state.allCsvRows) ? state.allCsvRows : [];
  const matched = rows.filter(r => isCsvRowForField(r, targetField));
  const displayRows = matched.length > 0 ? matched : rows;
  const maxRows = 300;

  displayRows.slice(0, maxRows).forEach(r => {
    const tr = document.createElement("tr");
    tr.style.borderBottom = "1px solid #eee";
    tr.innerHTML = header
      .map(col => `<td style="padding:6px;">${escapeHtml(r[col] || "")}</td>`)
      .join("");
    tbody.appendChild(tr);
  });

  const suffix = displayRows.length > maxRows ? `（先頭${maxRows}件を表示）` : "";
  status.textContent = `all.csv ${rows.length}件中、${targetField || "対象圃場"} 該当 ${matched.length}件 ${suffix}`;
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

  const lines = normalized
    .split("\n")
    .map(v => v.trim())
    .filter(Boolean);

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

function syncRawJsonEditor() {
  const textarea = document.getElementById("raw-json-editor");
  const status = document.getElementById("raw-json-status");
  if (!textarea || !status) return;

  if (state.selectedIndex == null || !state.rows[state.selectedIndex]) {
    textarea.value = "";
    status.textContent = "行を選択するとJSONを表示します";
    return;
  }

  const row = state.rows[state.selectedIndex];
  textarea.value = JSON.stringify(row.raw || {}, null, 2);
  status.textContent = `行 #${state.selectedIndex + 1} を編集中`;
}

function applyRawJsonToSelectedRow() {
  if (state.selectedIndex == null || !state.rows[state.selectedIndex]) {
    alert("先に行を選択してください");
    return;
  }

  const textarea = document.getElementById("raw-json-editor");
  const status = document.getElementById("raw-json-status");
  if (!textarea) return;

  let parsed;
  try {
    parsed = JSON.parse(textarea.value || "{}");
  } catch (e) {
    alert(`JSONの形式が不正です: ${e.message}`);
    return;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    alert("JSONオブジェクトを入力してください");
    return;
  }

  const row = state.rows[state.selectedIndex];
  row.raw = parsed;
  applyRawToDisplayFields(row);
  renderRows();
  syncRawJsonEditor();
  if (status) status.textContent = "JSONを適用しました";
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
    const path = `/logs/${type}/${safe}.json`;
    const data = await loadJSON(path).catch(() => null);
    if (!data?.years || typeof data.years !== "object") continue;

    let changed = false;

    Object.keys(data.years).forEach(year => {
      const list = data.years[year]?.entries;
      if (!Array.isArray(list)) return;

      for (let i = 0; i < list.length; i++) {
        const current = list[i];
        const fp = createEntryFingerprint(current);
        if (!updateMap.has(fp)) continue;

        const next = mergeEntryForRelatedField(current, updateMap.get(fp));
        list[i] = next;
        changed = true;
        updatedCount += 1;
      }
    });

    if (changed) {
      overrides[safe] = data;
    }
  }

  return { overrides, updatedCount };
}

function createEntryFingerprint(entry) {
  if (!entry || typeof entry !== "object") return "";
  const parts = [
    String(entry.date || "").trim(),
    String(entry.workType || "").trim(),
    normalizeMachine(entry),
    normalizeWorkers(entry),
    normalizeMethod(entry),
    normalizePesticides(entry),
    String(entry.notes || "").trim()
  ];

  return parts.join("||");
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

function parseWorkers(text) {
  const parts = String(text || "")
    .split(/[\/,／、]/)
    .map(v => v.trim())
    .filter(Boolean);

  return parts;
}

function getDistributedNames(distributed) {
  if (!Array.isArray(distributed)) return "";

  const names = Array.from(
    new Set(
      distributed
        .map(d => String(d?.name || "").trim())
        .filter(Boolean)
    )
  );

  return names.join("、");
}

function toCsvCell(value) {
  const s = String(value ?? "");
  if (!/[",\n]/.test(s)) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

function getLogType() {
  return document.getElementById("log-type")?.value || "";
}

function getTargetField() {
  return document.getElementById("target-field")?.value || "";
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
