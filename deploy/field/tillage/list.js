import { verifyLocalAuth } from "/common/ui.js?v=1";
import { renderHeader } from "/common/header.js";
import { loadJSON } from "/common/json.js";
import { safeFieldName } from "/common/utils.js?v=1";

const state = {
  fields: [],
  rows: [],
  fieldCards: [],
  sortKey: "date",
  sortDirection: "desc",
  periodStart: "",
  periodEnd: "",
  fieldAreaMap: {}
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

function toYearMonth(dateText) {
  const normalized = normalizeDateText(dateText);
  if (!normalized) return "";
  return normalized.slice(0, 7);
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

function groupAgeClass(days) {
  if (days === null || days === undefined) return "fresh";
  if (days < 45) return "fresh";
  if (days < 90) return "warm";
  return "old";
}

async function loadFieldList() {
  const data = await loadJSON("/data/fields.json");
  return Array.isArray(data) ? data : [];
}

async function loadFieldAreas() {
  const data = await loadJSON("/data/field-detail.json");
  return data && typeof data === "object" ? data : {};
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
  const fieldDetail = await loadFieldAreas();
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
  state.fieldAreaMap = Object.fromEntries(fields.map(field => {
    const sizeA = Number(fieldDetail?.[field.name]?.size || 0);
    return [field.name, Number.isFinite(sizeA) ? sizeA / 10 : 0];
  }));
}

function filterRowsByPeriod(rows) {
  const start = state.periodStart ? toDateValue(state.periodStart) : 0;
  const end = state.periodEnd ? toDateValue(state.periodEnd) : 0;

  return rows.filter(row => {
    if (start && row.dateValue < start) return false;
    if (end && row.dateValue > end) return false;
    return true;
  });
}

function renderPeriodSummary() {
  const filteredRows = filterRowsByPeriod(state.rows);
  const fieldSet = new Set(filteredRows.map(row => row.field));

  const totalArea = filteredRows.reduce((sum, row) => sum + (state.fieldAreaMap[row.field] || 0), 0);

  const areaTotalEl = document.getElementById("period-area-total");
  const areaCountEl = document.getElementById("period-area-count");
  const fieldCountEl = document.getElementById("period-field-count");

  if (areaTotalEl) areaTotalEl.textContent = `${totalArea.toFixed(2)}反`;
  if (areaCountEl) areaCountEl.textContent = `${filteredRows.length}件の耕うん記録`;
  if (fieldCountEl) fieldCountEl.textContent = String(fieldSet.size);
}

function renderAreaList() {
  const areaList = document.getElementById("area-list");
  if (!areaList) return;

  const grouped = new Map();
  for (const card of state.fieldCards) {
    const areaName = card.area || "その他";
    if (!grouped.has(areaName)) grouped.set(areaName, []);
    grouped.get(areaName).push(card);
  }

  const areaEntries = [...grouped.entries()].map(([areaName, cards]) => {
    const visibleCards = [...cards].filter(card => card.count > 0);
    const latestAgeDays = visibleCards.length > 0
      ? Math.max(...visibleCards.map(card => card.latestAgeDays ?? 0))
      : null;
    const latestDate = visibleCards.length > 0
      ? visibleCards
          .filter(card => card.latestDate)
          .sort((a, b) => b.latestDate.localeCompare(a.latestDate))[0]?.latestDate || ""
      : "";
    const groupClass = groupAgeClass(latestAgeDays);

    return {
      areaName,
      cards: [...cards].sort((a, b) => {
        if (a.count === 0 && b.count > 0) return 1;
        if (a.count > 0 && b.count === 0) return -1;
        if (a.latestDate && b.latestDate) return b.latestDate.localeCompare(a.latestDate);
        return a.field.localeCompare(b.field, "ja");
      }),
      groupClass,
      latestAgeDays,
      latestDate,
      count: cards.reduce((sum, card) => sum + (card.count || 0), 0)
    };
  });

  areaEntries.sort((a, b) => {
    const aScore = a.latestAgeDays ?? -1;
    const bScore = b.latestAgeDays ?? -1;
    if (aScore !== bScore) return bScore - aScore;
    return a.areaName.localeCompare(b.areaName, "ja");
  });

  areaList.innerHTML = areaEntries.map(area => `
    <details class="area-group ${area.groupClass}" open>
      <summary class="area-title">
        <div class="area-title-main">
          <h3>${escapeHtml(area.areaName)}</h3>
          <span class="area-badge ${area.groupClass}">${area.latestAgeDays === null ? "未記録" : `最終耕うんから ${formatDaysAgo(area.latestAgeDays)}`}</span>
          <span class="pill pill-count">${area.count}件</span>
        </div>
        <div class="area-sub">${escapeHtml(area.latestDate || "未記録")}</div>
      </summary>

      <div class="field-list">
        ${area.cards.map(card => renderFieldCard(card)).join("")}
      </div>
    </details>
  `).join("");
}

function renderFieldCard(card) {
  const age = card.latestAgeDays === null ? "fresh" : ageClass(card.latestAgeDays);
  const detailLink = `/fields/index.html?field=${encodeURIComponent(card.field)}`;

  return `
    <article class="field-card ${age}">
      <div class="field-main">
        <div class="field-name">
          <h3><a href="${detailLink}">${escapeHtml(card.field)}</a></h3>
          <span class="field-area ${age}">${escapeHtml(card.area || "圃場")}</span>
        </div>
        <div class="field-meta">
          <div class="field-meta-line">
            <span class="pill pill-date">最終耕うん: ${escapeHtml(card.latestDate || "未記録")}</span>
            <span class="pill pill-count">件数: ${card.count}</span>
          </div>
          <div class="age-chip ${age}">${card.latestAgeDays === null ? "未記録" : `最終耕うんから ${formatDaysAgo(card.latestAgeDays)}`}</div>
          <div>直近: ${escapeHtml(card.latestWorkType)}</div>
          <div>前回との差: ${card.latestGapDays === null ? "初回" : `${card.latestGapLabel}`}</div>
        </div>
      </div>
      <a class="secondary-btn field-link" href="${detailLink}">圃場詳細</a>
    </article>
  `;
}

function renderTable() {
  const body = document.getElementById("log-body");
  if (!body) return;

  let rows = filterRowsByPeriod([...state.rows]);

  const direction = state.sortDirection === "asc" ? 1 : -1;
  if (state.sortKey === "gap") {
    rows.sort((a, b) => {
      const av = a.gapDays ?? -1;
      const bv = b.gapDays ?? -1;
      if (av !== bv) return (av - bv) * direction;
      return direction * b.date.localeCompare(a.date);
    });
  } else {
    rows.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date) * direction;
      return direction * b.field.localeCompare(a.field, "ja");
    });
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

function updateSortHeaderLabels() {
  const dateHeader = document.getElementById("date-sort-header");
  const gapHeader = document.getElementById("gap-sort-header");
  const dateLabel = state.sortKey === "date"
    ? `日付 ${state.sortDirection === "asc" ? "▲" : "▼"}`
    : "日付";
  const gapLabel = state.sortKey === "gap"
    ? `前回から ${state.sortDirection === "asc" ? "▲" : "▼"}`
    : "前回から";

  if (dateHeader) dateHeader.textContent = dateLabel;
  if (gapHeader) gapHeader.textContent = gapLabel;
}

function setSort(key) {
  if (state.sortKey === key) {
    state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
  } else {
    state.sortKey = key;
    state.sortDirection = "desc";
  }

  const select = document.getElementById("sort-select");
  if (select && (key === "date" || key === "gap")) {
    select.value = "recent";
  }

  updateSortHeaderLabels();
  renderTable();
}

function bindPeriodControls() {
  const startInput = document.getElementById("period-start");
  const endInput = document.getElementById("period-end");
  const resetBtn = document.getElementById("period-reset");

  if (startInput) {
    startInput.value = state.periodStart;
    startInput.addEventListener("change", () => {
      state.periodStart = startInput.value || "";
      renderPeriodSummary();
      renderAreaList();
      renderTable();
    });
  }

  if (endInput) {
    endInput.value = state.periodEnd;
    endInput.addEventListener("change", () => {
      state.periodEnd = endInput.value || "";
      renderPeriodSummary();
      renderAreaList();
      renderTable();
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      state.periodStart = "";
      state.periodEnd = "";
      if (startInput) startInput.value = "";
      if (endInput) endInput.value = "";
      renderPeriodSummary();
      renderAreaList();
      renderTable();
    });
  }
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
  bindPeriodControls();
  renderPeriodSummary();
  renderAreaList();
  updateSortHeaderLabels();
  renderTable();

  document.getElementById("date-sort-header")?.addEventListener("click", () => setSort("date"));
  document.getElementById("gap-sort-header")?.addEventListener("click", () => setSort("gap"));
}

main();