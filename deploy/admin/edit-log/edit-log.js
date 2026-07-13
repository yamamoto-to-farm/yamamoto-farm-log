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
  fertilizer: [
    "date", "workType", "workers", "machine", "notes",
    "fertilizerItems", "distributed", "sourceWorkType", "sourceWork",
    "sourceRidgeCount", "sourceRidgeHeightCm", "sourceRidgeWidthCm", "attachment"
  ],
  pesticide: [
    "date", "workType", "workers", "machine", "notes",
    "distributed", "attachment"
  ],
  tillage: [
    "date", "workType", "workers", "machine", "notes",
    "depthCm", "speedKmh", "attachment"
  ],
  weeding: [
    "date", "workType", "workers", "machine", "notes",
    "sprayMethod", "mowingMethod", "pesticides", "pesticideUsage", "distributed", "attachment"
  ],
  "hand-weeding": [
    "date", "workType", "workers", "machine", "notes", "attachment"
  ],
  watering: [
    "date", "workType", "workers", "machine", "notes",
    "startTime", "endTime", "irrigationMinutes", "attachment"
  ],
  intertill: [
    "date", "workType", "workers", "machine", "notes",
    "ridgeCount", "ridgeHeightCm", "ridgeWidthCm", "attachment"
  ],
  bedmaking: [
    "date", "workType", "workers", "machine", "notes",
    "ridgeCount", "ridgeHeightCm", "ridgeWidthCm", "attachment"
  ],
  "field-maintenance": [
    "date", "workType", "workers", "machine", "notes", "attachment"
  ]
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

const METHOD_OPTIONS = {
  sprayMethod: ["背負動力噴霧機", "エンジン動噴", "ドローン", "手撒き"],
  mowingMethod: ["フレールモア", "背負い式刈払機", "ハンマーナイフ", "手作業"]
};

export async function initEditLogPage() {
  await loadFieldOptions();
  bindEvents();
  setStatus("ログタイプと圃場を選んで読み込んでください。");
  renderDynamicFieldEditor();
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
    state.selectedIndex = state.rows.length - 1;
    renderRows();
    renderDynamicFieldEditor();
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
      renderDynamicFieldEditor();
    };
  }

  const saveBtn = document.getElementById("save-btn");
  if (saveBtn) saveBtn.onclick = () => saveCurrentLog();
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
  renderDynamicFieldEditor();
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
  const type = getLogType();
  const base = {
    date: "",
    workType: getDefaultWorkType(type),
    machine: "",
    workers: [],
    notes: ""
  };

  return {
    raw: base,
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
    input = document.createElement("select");
    input.className = "form-input";
    input.innerHTML = `
      <option value="">(未設定)</option>
      <option value="true">true</option>
      <option value="false">false</option>
    `;
    input.value = value === true ? "true" : value === false ? "false" : "";
    input.addEventListener("change", () => setDynamicValue(row, key, input.value, editorType));
  } else if (editorType === "workType") {
    input = document.createElement("select");
    input.className = "form-input";

    const options = Array.from(new Set([
      "",
      ...(WORKTYPE_OPTIONS[type] || []),
      String(value || "").trim()
    ])).filter(v => v !== "");

    input.innerHTML = ["<option value=\"\"></option>"]
      .concat(options.map(v => `<option value="${escapeAttr(v)}">${escapeHtml(v)}</option>`))
      .join("");
    input.value = String(value || "");
    input.addEventListener("change", () => {
      setDynamicValue(row, key, input.value, editorType);
      renderRows();
      renderDynamicFieldEditor();
    });
  } else if (editorType === "method") {
    input = document.createElement("select");
    input.className = "form-input";

    const options = Array.from(new Set([
      "",
      ...(METHOD_OPTIONS[key] || []),
      String(value || "").trim()
    ])).filter(v => v !== "");

    input.innerHTML = ["<option value=\"\"></option>"]
      .concat(options.map(v => `<option value="${escapeAttr(v)}">${escapeHtml(v)}</option>`))
      .join("");
    input.value = String(value || "");
    input.addEventListener("change", () => setDynamicValue(row, key, input.value, editorType));
  } else if (editorType === "workers") {
    input = document.createElement("textarea");
    input.className = "form-input";
    input.rows = 3;
    input.style.fontFamily = "inherit";
    const text = Array.isArray(value)
      ? value.map(v => String(v || "").trim()).filter(Boolean).join("\n")
      : String(value || "").split(/[\/,／、]/).map(v => v.trim()).filter(Boolean).join("\n");
    input.value = text;
    input.placeholder = "1行1名（または / 区切り）";
    input.addEventListener("input", () => setDynamicValue(row, key, input.value, editorType));
  } else if (editorType === "list") {
    input = document.createElement("textarea");
    input.className = "form-input";
    input.rows = 4;
    input.style.fontFamily = "inherit";
    input.value = Array.isArray(value)
      ? value.map(v => String(v ?? "")).join("\n")
      : "";
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
      if (!ok) {
        input.style.borderColor = "#c0392b";
      } else {
        input.style.borderColor = "";
      }
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

function setDynamicValue(row, key, inputValue, editorType) {
  if (!row.raw || typeof row.raw !== "object") row.raw = {};

  try {
    if (editorType === "number") {
      if (String(inputValue || "").trim() === "") {
        row.raw[key] = "";
      } else {
        row.raw[key] = Number(inputValue);
      }
    } else if (editorType === "boolean") {
      if (inputValue === "true") row.raw[key] = true;
      else if (inputValue === "false") row.raw[key] = false;
      else row.raw[key] = "";
    } else if (editorType === "workers") {
      row.raw[key] = parseWorkers(inputValue);
    } else if (editorType === "list") {
      row.raw[key] = String(inputValue || "")
        .split("\n")
        .map(v => v.trim())
        .filter(Boolean);
    } else if (editorType === "json") {
      const text = String(inputValue || "").trim();
      if (!text) {
        row.raw[key] = Array.isArray(row.raw[key]) ? [] : {};
      } else {
        row.raw[key] = JSON.parse(text);
      }
    } else {
      row.raw[key] = inputValue;
    }
  } catch (e) {
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

function getDefaultWorkType(type) {
  const arr = WORKTYPE_OPTIONS[type] || [];
  return arr[0] || "";
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
  if (!/[",\n\r]/.test(s)) return s;
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
