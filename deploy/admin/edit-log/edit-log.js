import { loadJSON } from "/common/json.js?v=1";
import { saveLog } from "/common/save/index.js?v=1";
import { safeFieldName } from "/common/utils.js?v=1";

let state = {
  fields: [],
  rows: [],
  selectedIndex: null,
  loadedType: "",
  loadedField: ""
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
    });

    tr.querySelectorAll("input").forEach(input => {
      input.addEventListener("input", () => {
        const key = input.dataset.key;
        if (!key) return;
        state.rows[idx][key] = input.value;
      });

      input.addEventListener("click", ev => {
        ev.stopPropagation();
        state.selectedIndex = idx;
        renderRows();
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

  const fileObj = toLogFileObject(field, normalizedRows);
  const safe = safeFieldName(field);
  const jsonPath = `logs/${type}/${safe}.json`;

  setStatus("all.csv を再生成しています…");
  const csvText = await rebuildAllCsv(type);

  await saveLog({
    type: "multi",
    files: [
      {
        path: jsonPath,
        content: JSON.stringify(fileObj, null, 2)
      },
      {
        path: `logs/${type}/all.csv`,
        content: csvText
      }
    ]
  });

  state.loadedType = type;
  state.loadedField = field;
  setStatus(`保存しました: ${field} / ${type}（${normalizedRows.length}件）`);
}

async function rebuildAllCsv(type) {
  const fieldNames = state.fields || [];
  const rows = [];

  for (const fieldName of fieldNames) {
    const safe = safeFieldName(fieldName);
    const path = `/logs/${type}/${safe}.json`;
    const data = await loadJSON(path).catch(() => null);
    if (!data) continue;

    const entries = flattenEntries(data);
    entries.forEach(e => {
      rows.push({
        date: String(e.date || "").trim(),
        worker: formatWorkersForCsv(e.workers),
        field: fieldName,
        machine: String(e.machine || "").trim()
      });
    });
  }

  rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const lines = ["date,worker,field,machine"];
  rows.forEach(r => {
    lines.push([
      toCsvCell(r.date),
      toCsvCell(r.worker),
      toCsvCell(r.field),
      toCsvCell(r.machine)
    ].join(","));
  });

  return lines.join("\n") + "\n";
}

function toLogFileObject(fieldName, rows) {
  const safe = safeFieldName(fieldName);
  const years = {};

  rows.forEach(r => {
    const year = String(r.date || "").slice(0, 4) || "unknown";
    if (!years[year]) years[year] = { entries: [] };

    years[year].entries.push({
      ...r.raw,
      date: r.date,
      workType: r.workType,
      machine: r.machine,
      workers: parseWorkers(r.workersText),
      notes: r.notes
    });
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
  return {
    raw: { ...entry },
    date: String(entry.date || "").slice(0, 10),
    workType: String(entry.workType || ""),
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
    raw: row.raw || {},
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

function parseWorkers(text) {
  const parts = String(text || "")
    .split(/[\/,／、]/)
    .map(v => v.trim())
    .filter(Boolean);

  return parts;
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
