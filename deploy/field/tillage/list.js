import { verifyLocalAuth } from "/common/ui.js?v=1";
import { renderHeader } from "/common/header.js";
import { loadJSON } from "/common/json.js";
import { safeFieldName } from "/common/utils.js?v=1";

const state = {
  fields: [],
  rows: [],
  fieldCards: []
};

function normalizeDateText(value) {
  const text = String(value || "").trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const slash = text.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (slash) {
    const mm = String(Number(slash[2])).padStart(2, "0");
    const dd = String(Number(slash[3])).padStart(2, "0");
    return `${slash[1]}-${mm}-${dd}`;
  }

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return "";
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function toDateValue(dateText) {
  const normalized = normalizeDateText(dateText);
  if (!normalized) return 0;
  const date = new Date(`${normalized}T00:00:00`);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function formatDaysAgo(days) {
  if (days === null || days === undefined) return "-";
  if (days === 0) return "本日";
  return `${days}日前`;
}

function formatDaysGap(days) {
  if (days === null || days === undefined) return "初回";
  if (days === 0) return "同日";
  return `${days}日`;
}

function getTodayValue() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function diffDays(later, earlier) {
  const gap = Math.round((later - earlier) / 86400000);
  return Number.isFinite(gap) ? gap : null;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function flattenEntries(logData) {
  const years = logData?.years || {};
  const out = [];

  Object.keys(years).forEach(year => {
    const entries = years[year]?.entries;
    if (!Array.isArray(entries)) return;

    entries.forEach(entry => {
      if (entry && typeof entry === "object") out.push(entry);
    });
  });

  return out;
}

function pickDateText(entry) {
  return entry?.date || entry?.workDate || entry?.timestamp || entry?.createdAt || "";
}

function formatWorkers(workers) {
  if (Array.isArray(workers)) {
    return workers.map(v => String(v || "").trim()).filter(Boolean).join("、");
  }

  if (workers && typeof workers === "object") {
    if (Array.isArray(workers.list)) {
      return workers.list.map(v => String(v || "").trim()).filter(Boolean).join("、");
    }

    return Object.values(workers).map(v => String(v || "").trim()).filter(Boolean).join("、");
  }

  return String(workers || "").trim();
}

function renderWorkBadge(workType) {
  const label = String(workType || "耕うん（ロータリー）");
  const isSubsoiler = label.includes("サブソイラー");
  const className = isSubsoiler ? "badge-subsoiler" : "badge-rotary";
  return `<span class="badge ${className}">${escapeHtml(label)}</span>`;
}

function ageClass(days) {
  if (days === null || days === undefined) return "fresh";
  if (days < 45) return "fresh";
  if (days < 90) return "warm";
  return "old";
}

async function loadFieldList() {
  const data = await loadJSON("/data/fields.json");
  return Array.isArray(data) ? data : [];
}

async function loadTillageLog(fieldName) {
  const file = safeFieldName(fieldName);
  const url = `/logs/tillage/${encodeURIComponent(file)}.json`;

  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return { years: {} };
    const data = await res.json();
    return data && typeof data === "object" ? data : { years: {} };
  } catch {
    return { years: {} };
  }
}

function normalizeEntry(fieldMeta, entry) {
  const date = normalizeDateText(pickDateText(entry));
  if (!date) return null;

  return {
    field: fieldMeta.name,
    area: fieldMeta.area || "",
    date,
    dateValue: toDateValue(date),
    workType: String(entry.workType || "耕うん（ロータリー）").trim(),
    depthCm: Number(entry.depthCm || 0),
    speedKmh: Number(entry.speedKmh || 0),
    machine: String(entry.machine || "").trim(),
    workers: formatWorkers(entry.workers),
    notes: String(entry.notes || "").trim()
  };
}

async function loadRows() {
  const fields = await loadFieldList();
  const loaded = await Promise.all(fields.map(async field => ({
    meta: field,
    log: await loadTillageLog(field.name)
  })));

  const rows = [];
  const fieldCards = [];
  const todayValue = getTodayValue();

  loaded.forEach(({ meta, log }) => {
    const entries = flattenEntries(log)
      .map(entry => normalizeEntry(meta, entry))
      .filter(Boolean)
      .sort((a, b) => a.dateValue - b.dateValue);

    if (entries.length === 0) {
      fieldCards.push({
        field: meta.name,
        area: meta.area || "",
        count: 0,
        latestDate: "",
        latestAgeDays: null,
        latestWorkType: "未記録",
        latestGapDays: null,
        latestGapLabel: "-",
        hasRecent: false
      });
      return;
    }

    entries.forEach((item, index) => {
      const prev = entries[index - 1] || null;
      const gapDays = prev ? diffDays(item.dateValue, prev.dateValue) : null;

      rows.push({
        ...item,
        gapDays,
        gapLabel: formatDaysGap(gapDays),
        prevDate: prev ? prev.date : ""
      });
    });

    const latest = entries[entries.length - 1];
    const latestAgeDays = diffDays(todayValue, latest.dateValue);
    const latestGapDays = entries.length > 1 ? diffDays(latest.dateValue, entries[entries.length - 2].dateValue) : null;

    fieldCards.push({
      field: meta.name,
      area: meta.area || "",
      count: entries.length,
      latestDate: latest.date,
      latestAgeDays,
      latestWorkType: latest.workType,
      latestGapDays,
      latestGapLabel: formatDaysGap(latestGapDays),
      hasRecent: latestAgeDays !== null && latestAgeDays < 90
    });
  });

  state.fields = fields;
  state.rows = rows;
  state.fieldCards = fieldCards;
}

function renderSummary() {
  const cards = state.fieldCards;
  const rows = state.rows;
  const withLogs = cards.filter(card => card.count > 0);

  document.getElementById("summary-field-count").textContent = String(withLogs.length);
  document.getElementById("summary-log-count").textContent = String(rows.length);

  const latestCard = withLogs
    .filter(card => card.latestDate)
    .sort((a, b) => b.latestDate.localeCompare(a.latestDate))[0];

  const maxGapCard = withLogs
    .filter(card => card.latestAgeDays !== null)
    .sort((a, b) => (b.latestAgeDays || 0) - (a.latestAgeDays || 0))[0];

  document.getElementById("summary-latest-date").textContent = latestCard?.latestDate || "-";
  document.getElementById("summary-latest-field").textContent = latestCard
    ? `${latestCard.field} / ${formatDaysAgo(latestCard.latestAgeDays)} / ${latestCard.latestWorkType}`
    : "-";

  document.getElementById("summary-max-gap").textContent = maxGapCard
    ? `${formatDaysAgo(maxGapCard.latestAgeDays)}`
    : "-";
  document.getElementById("summary-max-gap-field").textContent = maxGapCard
    ? `${maxGapCard.field} / ${maxGapCard.area || "圃場未設定"}`
    : "-";
}

function renderFieldGrid() {
  const grid = document.getElementById("field-grid");
  if (!grid) return;

  const cards = [...state.fieldCards].sort((a, b) => {
    if (a.count === 0 && b.count > 0) return 1;
    if (a.count > 0 && b.count === 0) return -1;
    if (a.latestDate && b.latestDate) return b.latestDate.localeCompare(a.latestDate);
    return a.field.localeCompare(b.field, "ja");
  });

  grid.innerHTML = cards.map(card => {
    const age = card.latestAgeDays === null ? "fresh" : ageClass(card.latestAgeDays);
    const cardClass = card.hasRecent ? "has-recent" : (card.count === 0 ? "" : "stale");
    const detailLink = `/fields/index.html?field=${encodeURIComponent(card.field)}`;

    return `
      <article class="field-card ${cardClass}">
        <div class="field-name">
          <h3><a href="${detailLink}">${escapeHtml(card.field)}</a></h3>
          <span class="area-text">${escapeHtml(card.area || "圃場")}</span>
        </div>
        <div class="field-meta">
          <div class="meta-row">
            <span class="pill pill-date">最終耕うん: ${escapeHtml(card.latestDate || "未記録")}</span>
            <span class="pill pill-count">件数: ${card.count}</span>
          </div>
          <div class="age-chip ${age}">${card.latestAgeDays === null ? "未記録" : `最終耕うんから ${formatDaysAgo(card.latestAgeDays)}`}</div>
          <div>直近: ${escapeHtml(card.latestWorkType)}</div>
          <div>前回との差: ${card.latestGapDays === null ? "初回" : `${card.latestGapLabel}`}</div>
        </div>
      </article>
    `;
  }).join("");
}

function renderTable() {
  const body = document.getElementById("log-body");
  if (!body) return;

  const query = String(document.getElementById("search-input")?.value || "").trim().toLowerCase();
  const sort = String(document.getElementById("sort-select")?.value || "recent");

  let rows = [...state.rows];

  if (query) {
    rows = rows.filter(row => {
      const haystack = [row.field, row.area, row.workType, row.machine, row.workers, row.notes]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }

  if (sort === "field") {
    rows.sort((a, b) => a.field.localeCompare(b.field, "ja") || b.date.localeCompare(a.date));
  } else if (sort === "gap") {
    rows.sort((a, b) => (b.gapDays ?? -1) - (a.gapDays ?? -1) || b.date.localeCompare(a.date));
  } else {
    rows.sort((a, b) => b.date.localeCompare(a.date));
  }

  if (rows.length === 0) {
    body.innerHTML = `
      <tr>
        <td colspan="9" class="empty-state">該当する記録がありません。</td>
      </tr>
    `;
    return;
  }

  body.innerHTML = rows.map(row => `
    <tr>
      <td>${escapeHtml(row.date)}</td>
      <td><a href="/fields/index.html?field=${encodeURIComponent(row.field)}">${escapeHtml(row.field)}</a>${row.area ? `<div class="sub-note">${escapeHtml(row.area)}</div>` : ""}</td>
      <td>${renderWorkBadge(row.workType)}</td>
      <td>${row.gapDays === null ? "初回" : `<strong>前回から ${escapeHtml(formatDaysGap(row.gapDays))}</strong>`}${row.prevDate ? `<div class="sub-note">前回: ${escapeHtml(row.prevDate)}</div>` : ""}</td>
      <td>${row.depthCm ? `${row.depthCm}cm` : "-"}</td>
      <td>${row.speedKmh ? `${row.speedKmh}km/h` : "-"}</td>
      <td>${escapeHtml(row.machine || "-")}</td>
      <td>${escapeHtml(row.workers || "-")}</td>
      <td>${escapeHtml(row.notes || "")}</td>
    </tr>
  `).join("");
}

async function main() {
  const ok = await verifyLocalAuth();
  if (!ok) return;

  renderHeader();

  if (window.currentRole === "worker") {
    alert("このページは家族または管理者のみ閲覧できます");
    location.href = "/";
    return;
  }

  document.getElementById("page-area").style.display = "block";

  await loadRows();
  renderSummary();
  renderFieldGrid();
  renderTable();

  document.getElementById("search-input").addEventListener("input", renderTable);
  document.getElementById("sort-select").addEventListener("change", renderTable);
}

main();