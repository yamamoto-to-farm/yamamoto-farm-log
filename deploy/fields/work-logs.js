// fields/work-logs.js
import { safeFieldName } from "/common/utils.js?v=1";

const CF_BASE = "https://d3sscxnlo0qnhe.cloudfront.net";
const VALID_TYPES = [
  "all",
  "pesticide",
  "fertilizer",
  "intertill",
  "bedmaking",
  "watering",
  "weeding",
  "tillage",
  "hand-weeding"
];

export async function initFieldWorkLogsPage() {
  const params = new URLSearchParams(location.search);
  const field = params.get("field") || "";
  const start = params.get("start") || "";
  const end = params.get("end") || "";
  const type = params.get("type") || "all";

  if (!field) {
    alert("field パラメータが必要です");
    location.href = "/fields/index.html";
    return;
  }

  const fieldInput = document.getElementById("field");
  const startInput = document.getElementById("start");
  const endInput = document.getElementById("end");
  const typeInput = document.getElementById("type");

  if (fieldInput) fieldInput.value = field;
  if (startInput) startInput.value = start;
  if (endInput) endInput.value = end;
  if (typeInput) typeInput.value = VALID_TYPES.includes(type) ? type : "all";

  const title = document.getElementById("page-title");
  if (title) title.textContent = `${field} 作業記録一覧`;

  const backBtn = document.getElementById("back-field-btn");
  if (backBtn) {
    backBtn.onclick = () => {
      location.href = `/fields/index.html?field=${encodeURIComponent(field)}`;
    };
  }

  const applyBtn = document.getElementById("apply-btn");
  if (applyBtn) {
    applyBtn.onclick = () => {
      const q = new URLSearchParams({
        field,
        start: startInput?.value || "",
        end: endInput?.value || "",
        type: typeInput?.value || "all"
      });
      location.href = `/fields/work-logs.html?${q.toString()}`;
    };
  }

  await renderRows({
    field,
    start: startInput?.value || "",
    end: endInput?.value || "",
    type: typeInput?.value || "all"
  });
}

async function renderRows({ field, start, end, type }) {
  const rowsEl = document.getElementById("rows");
  const kpiEl = document.getElementById("kpi-line");
  if (!rowsEl || !kpiEl) return;

  const safeField = safeFieldName(field);

  const [pesticide, fertilizer, intertill, bedmaking, watering, weeding, tillage, handWeeding] = await Promise.all([
    loadFieldLog("pesticide", safeField),
    loadFieldLog("fertilizer", safeField),
    loadFieldLog("intertill", safeField),
    loadFieldLog("bedmaking", safeField),
    loadFieldLog("watering", safeField),
    loadFieldLog("weeding", safeField),
    loadFieldLog("tillage", safeField),
    loadFieldLog("hand-weeding", safeField)
  ]);

  const allRows = [
    ...normalizePesticideRows(pesticide),
    ...normalizeFertilizerRows(fertilizer),
    ...normalizeIntertillRows(intertill),
    ...normalizeBedmakingRows(bedmaking),
    ...normalizeWateringRows(watering),
    ...normalizeWeedingRows(weeding),
    ...normalizeTillageRows(tillage),
    ...normalizeHandWeedingRows(handWeeding)
  ];

  const filtered = allRows
    .filter(r => type === "all" ? true : r.type === type)
    .filter(r => inDateRange(r.date, start, end))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const countPesticide = filtered.filter(r => r.type === "pesticide").length;
  const countFertilizer = filtered.filter(r => r.type === "fertilizer").length;
  const countIntertill = filtered.filter(r => r.type === "intertill").length;
  const countBedmaking = filtered.filter(r => r.type === "bedmaking").length;
  const countWatering = filtered.filter(r => r.type === "watering").length;
  const countWeeding = filtered.filter(r => r.type === "weeding").length;
  const countTillage = filtered.filter(r => r.type === "tillage").length;
  const countHandWeeding = filtered.filter(r => r.type === "hand-weeding").length;

  kpiEl.innerHTML = `
    <span class="kpi-chip">表示件数: ${filtered.length}件</span>
    <span class="kpi-chip">防除: ${countPesticide}回</span>
    <span class="kpi-chip">施肥: ${countFertilizer}回</span>
    <span class="kpi-chip">中耕: ${countIntertill}回</span>
    <span class="kpi-chip">畝立て: ${countBedmaking}回</span>
    <span class="kpi-chip">潅水: ${countWatering}回</span>
    <span class="kpi-chip">除草: ${countWeeding}回</span>
    <span class="kpi-chip">耕起: ${countTillage}回</span>
    <span class="kpi-chip">手作業除草: ${countHandWeeding}回</span>
  `;

  if (filtered.length === 0) {
    rowsEl.innerHTML = `
      <tr>
        <td colspan="6" style="text-align:center; color:#666; padding:18px;">該当する記録がありません。</td>
      </tr>
    `;
    return;
  }

  rowsEl.innerHTML = filtered.map(r => `
    <tr>
      <td>${escapeHtml(r.date || "-")}</td>
      <td>${renderTypeBadge(r.type, r.subType)}</td>
      <td>
        <div>${escapeHtml(r.workLabel || "-")}</div>
        ${r.subLabel ? `<div class="sub-note">${escapeHtml(r.subLabel)}</div>` : ""}
      </td>
      <td>${escapeHtml(r.machine || "-")}</td>
      <td>${escapeHtml(r.workers || "-")}</td>
      <td>${escapeHtml(r.notes || "")}</td>
    </tr>
  `).join("");
}

async function loadFieldLog(type, safeField) {
  const path = `${CF_BASE}/logs/${type}/${encodeURIComponent(safeField)}.json?ts=${Date.now()}`;

  try {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) return { years: {} };

    const data = await res.json();
    if (!data || typeof data !== "object") return { years: {} };
    return data;
  } catch {
    return { years: {} };
  }
}

function normalizePesticideRows(logData) {
  const entries = flattenEntries(logData);

  return entries.map(e => ({
    type: "pesticide",
    date: normalizeDateText(pickDateText(e)),
    subType: "防除",
    workLabel: e.workType || "防除",
    subLabel: getNamesFromDistributed(e.distributed),
    machine: e.machine || "",
    workers: formatWorkers(e.workers),
    notes: e.notes || ""
  }));
}

function normalizeFertilizerRows(logData) {
  const entries = flattenEntries(logData);

  return entries.map(e => {
    const isLinked = Boolean(e.sourceWork);
    const subType = isLinked ? "同時施肥" : "単独施肥";
    const source = e.sourceWorkType || e.sourceWork || "";

    return {
      type: "fertilizer",
      date: normalizeDateText(pickDateText(e)),
      subType,
      workLabel: isLinked ? `施肥（${source || "連携"}）` : "施肥（単独）",
      subLabel: getNamesFromDistributed(e.distributed),
      machine: e.machine || "",
      workers: formatWorkers(e.workers),
      notes: e.notes || ""
    };
  });
}

function normalizeIntertillRows(logData) {
  const entries = flattenEntries(logData);

  return entries.map(e => ({
    type: "intertill",
    date: normalizeDateText(pickDateText(e)),
    subType: "中耕",
    workLabel: e.attachment || e.workType || "中耕",
    subLabel: "",
    machine: e.machine || "",
    workers: formatWorkers(e.workers),
    notes: e.notes || ""
  }));
}

function normalizeBedmakingRows(logData) {
  const entries = flattenEntries(logData);

  return entries.map(e => ({
    type: "bedmaking",
    date: normalizeDateText(pickDateText(e)),
    subType: "畝立て",
    workLabel: e.attachment || e.workType || "畝立て",
    subLabel: e.ridgeCount != null ? `畝数: ${e.ridgeCount}` : "",
    machine: e.machine || "",
    workers: formatWorkers(e.workers),
    notes: e.notes || ""
  }));
}

function normalizeWateringRows(logData) {
  const entries = flattenEntries(logData);

  return entries.map(e => ({
    type: "watering",
    date: normalizeDateText(pickDateText(e)),
    subType: "潅水",
    workLabel: e.workType || "潅水",
    subLabel: e.irrigationMinutes != null ? `潅水時間: ${e.irrigationMinutes}分` : "",
    machine: e.machine || "",
    workers: formatWorkers(e.workers),
    notes: e.notes || ""
  }));
}

function normalizeWeedingRows(logData) {
  const entries = flattenEntries(logData);

  return entries.map(e => ({
    type: "weeding",
    date: normalizeDateText(pickDateText(e)),
    subType: "除草・草刈り",
    workLabel: e.workType || "除草・草刈り",
    subLabel: getNamesFromDistributed(e.distributed),
    machine: e.machine || "",
    workers: formatWorkers(e.workers),
    notes: e.notes || ""
  }));
}

function normalizeTillageRows(logData) {
  const entries = flattenEntries(logData);

  return entries.map(e => ({
    type: "tillage",
    date: normalizeDateText(pickDateText(e)),
    subType: "土づくり・耕起",
    workLabel: e.workType || "土づくり・耕起",
    subLabel: "",
    machine: e.machine || "",
    workers: formatWorkers(e.workers),
    notes: e.notes || ""
  }));
}

function normalizeHandWeedingRows(logData) {
  const entries = flattenEntries(logData);

  return entries.map(e => ({
    type: "hand-weeding",
    date: normalizeDateText(pickDateText(e)),
    subType: "手作業除草",
    workLabel: e.workType || "手作業除草",
    subLabel: "",
    machine: e.machine || "",
    workers: formatWorkers(e.workers),
    notes: e.notes || ""
  }));
}

function flattenEntries(logData) {
  const years = logData?.years || {};
  const out = [];

  Object.keys(years).forEach(y => {
    const list = years[y]?.entries;
    if (!Array.isArray(list)) return;

    list.forEach(e => {
      if (!e || typeof e !== "object") return;
      out.push(e);
    });
  });

  return out;
}

function inDateRange(dateText, start, end) {
  const dateVal = toDateValue(dateText);
  if (!dateVal) return false;

  const startVal = toDateValue(start);
  const endVal = toDateValue(end);

  if (startVal && dateVal < startVal) return false;
  if (endVal && dateVal > endVal) return false;
  return true;
}

function pickDateText(entry) {
  if (!entry || typeof entry !== "object") return "";

  return (
    entry.date ||
    entry.workDate ||
    entry.timestamp ||
    entry.createdAt ||
    ""
  );
}

function normalizeDateText(value) {
  const src = String(value || "").trim();
  if (!src) return "";

  // ISO 先頭10桁（YYYY-MM-DD）
  const isoLike = src.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoLike) return `${isoLike[1]}-${isoLike[2]}-${isoLike[3]}`;

  // スラッシュ形式（YYYY/MM/DD）
  const slash = src.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (slash) {
    const mm = String(Number(slash[2])).padStart(2, "0");
    const dd = String(Number(slash[3])).padStart(2, "0");
    return `${slash[1]}-${mm}-${dd}`;
  }

  const d = new Date(src);
  if (Number.isNaN(d.getTime())) return "";

  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function toDateValue(value) {
  const n = normalizeDateText(value);
  if (!n) return 0;
  const d = new Date(`${n}T00:00:00`);
  if (Number.isNaN(d.getTime())) return 0;
  return d.getTime();
}

function getNamesFromDistributed(distributed) {
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

function formatWorkers(workers) {
  if (Array.isArray(workers)) {
    return workers
      .map(v => String(v || "").trim())
      .filter(Boolean)
      .join("、");
  }

  if (workers && typeof workers === "object") {
    if (Array.isArray(workers.list)) {
      return workers.list
        .map(v => String(v || "").trim())
        .filter(Boolean)
        .join("、");
    }

    return Object.values(workers)
      .map(v => String(v || "").trim())
      .filter(Boolean)
      .join("、");
  }

  return String(workers || "").trim();
}

function renderTypeBadge(type, subType) {
  if (type === "pesticide") {
    return `<span class="badge badge-pesticide">防除</span>${subType ? `<div class="sub-note">${escapeHtml(subType)}</div>` : ""}`;
  }
  if (type === "fertilizer") {
    return `<span class="badge badge-fertilizer">施肥</span>${subType ? `<div class="sub-note">${escapeHtml(subType)}</div>` : ""}`;
  }
  if (type === "intertill") {
    return `<span class="badge badge-intertill">中耕</span>${subType ? `<div class="sub-note">${escapeHtml(subType)}</div>` : ""}`;
  }
  if (type === "bedmaking") {
    return `<span class="badge badge-bedmaking">畝立て</span>${subType ? `<div class="sub-note">${escapeHtml(subType)}</div>` : ""}`;
  }
  if (type === "watering") {
    return `<span class="badge badge-watering">潅水</span>${subType ? `<div class="sub-note">${escapeHtml(subType)}</div>` : ""}`;
  }
  if (type === "weeding") {
    return `<span class="badge badge-weeding">除草</span>${subType ? `<div class="sub-note">${escapeHtml(subType)}</div>` : ""}`;
  }
  if (type === "tillage") {
    return `<span class="badge badge-tillage">耕起</span>${subType ? `<div class="sub-note">${escapeHtml(subType)}</div>` : ""}`;
  }
  if (type === "hand-weeding") {
    return `<span class="badge badge-hand-weeding">手作業除草</span>${subType ? `<div class="sub-note">${escapeHtml(subType)}</div>` : ""}`;
  }
  return `<span class="badge">${escapeHtml(type)}</span>${subType ? `<div class="sub-note">${escapeHtml(subType)}</div>` : ""}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
