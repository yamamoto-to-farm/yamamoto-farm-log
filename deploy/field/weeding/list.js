import { loadAllWeedingLogs } from "./list-utils.js?v=1";
import { loadJSON } from "/common/json.js?v=1";
import { openFieldModal } from "/common/filter/filter-field.js?v=1";
import { setFilterData, filterState } from "/common/filter/filter-core.js?v=1";
import { initActiveFilterUI } from "/common/filter/filter-active.js?v=1";
import { setupSmartBackButton } from "/common/navigation-back.js?v=1";
import { getDefaultPeriodRange } from "/common/date-range.js?v=1";
import { collectUniqueMethods, matchesSharedListFilters } from "/common/list-filter-utils.js?v=1";
import { buildPeriodCountSummaryHtml } from "/common/period-summary.js?v=1";
import { buildAreaLatestModel, getAreaStatusMeta } from "/common/area-latest.js?v=1";

const MODES = {
  spray: {
    label: "除草剤散布",
    match: row => row.workType === "除草剤散布",
    note: "除草剤散布のみ表示中"
  },
  mowing: {
    label: "草刈り",
    match: row => row.workType === "草刈り",
    note: "草刈りのみ表示中"
  }
};

const state = {
  items: [],
  mode: "spray",
  areaSort: "new",
  periodStart: "",
  periodEnd: "",
  keyword: "",
  method: "",
  pesticide: "",
  fieldsData: [],
  fieldAreaMap: {}
};

function toDateValue(dateText) {
  const date = new Date(`${dateText}T00:00:00`);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function getTodayValue() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function ageClass(days) {
  if (days < 45) return "fresh";
  if (days < 90) return "warm";
  return "old";
}

function formatDaysAgo(days) {
  if (days === 0) return "本日";
  return `${days}日前`;
}

function getModeFromUrl() {
  const params = new URLSearchParams(location.search);
  const mode = String(params.get("mode") || "spray").trim();
  return MODES[mode] ? mode : "spray";
}

function setModeToUrl(mode) {
  const url = new URL(location.href);
  url.searchParams.set("mode", mode);
  history.replaceState({}, "", url.pathname + url.search);
}

function bindModeButtons() {
  const sprayBtn = document.getElementById("mode-spray");
  const mowingBtn = document.getElementById("mode-mowing");

  if (sprayBtn) {
    sprayBtn.onclick = () => {
      if (state.mode === "spray") return;
      state.mode = "spray";
      setModeToUrl(state.mode);
      render();
    };
  }

  if (mowingBtn) {
    mowingBtn.onclick = () => {
      if (state.mode === "mowing") return;
      state.mode = "mowing";
      setModeToUrl(state.mode);
      render();
    };
  }
}

function bindPeriodControls() {
  const startInput = document.getElementById("period-start");
  const endInput = document.getElementById("period-end");
  const resetBtn = document.getElementById("period-reset");

  if (startInput) {
    startInput.value = state.periodStart;
    startInput.addEventListener("change", () => {
      state.periodStart = startInput.value || "";
      render();
    });
  }

  if (endInput) {
    endInput.value = state.periodEnd;
    endInput.addEventListener("change", () => {
      state.periodEnd = endInput.value || "";
      render();
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      state.periodStart = "";
      state.periodEnd = "";
      if (startInput) startInput.value = "";
      if (endInput) endInput.value = "";
      render();
    });
  }
}

function bindAreaSortControl() {
  const select = document.getElementById("area-sort");
  if (!select) return;

  select.value = state.areaSort;
  select.addEventListener("change", () => {
    state.areaSort = String(select.value || "new").trim() === "old" ? "old" : "new";
    render();
  });
}

function bindFilterControls() {
  const fieldBtn = document.getElementById("open-field-modal");
  const methodSelect = document.getElementById("filter-method");
  const pesticideSelect = document.getElementById("filter-pesticide");
  const keywordInput = document.getElementById("filter-keyword");
  const resetBtn = document.getElementById("filter-reset");

  if (fieldBtn) {
    fieldBtn.onclick = () => openFieldModal({ mode: "filter" });
  }

  if (methodSelect) {
    methodSelect.addEventListener("change", () => {
      state.method = String(methodSelect.value || "").trim();
      render();
    });
  }

  if (pesticideSelect) {
    pesticideSelect.addEventListener("change", () => {
      state.pesticide = String(pesticideSelect.value || "").trim();
      render();
    });
  }

  if (keywordInput) {
    keywordInput.value = state.keyword;
    keywordInput.addEventListener("input", () => {
      state.keyword = String(keywordInput.value || "").trim();
      render();
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      filterState.fields = [];
      state.keyword = "";
      state.method = "";
      state.pesticide = "";
      if (methodSelect) methodSelect.value = "";
      if (pesticideSelect) pesticideSelect.value = "";
      if (keywordInput) keywordInput.value = "";
      window.dispatchEvent(new CustomEvent("filter:apply"));
      render();
    });
  }

  window.addEventListener("filter:apply", () => render());
  window.addEventListener("filter:reset", () => render());
}

function rowContainsPesticide(row, pesticideName) {
  const target = String(pesticideName || "").trim();
  if (!target) return true;

  const usageRows = Array.isArray(row.pesticideUsage) ? row.pesticideUsage : [];
  if (usageRows.some(u => String(u?.name || "").trim() === target)) return true;

  const distributedRows = Array.isArray(row.distributed) ? row.distributed : [];
  if (distributedRows.some(u => String(u?.name || "").trim() === target)) return true;

  const textNames = String(row.pesticides || "").split("／").map(v => v.trim()).filter(Boolean);
  return textNames.includes(target);
}

function filterRowsByPeriod(rows) {
  const start = state.periodStart ? toDateValue(state.periodStart) : 0;
  const end = state.periodEnd ? toDateValue(state.periodEnd) : 0;

  return rows.filter(row => {
    const v = toDateValue(row.date);
    if (start && v < start) return false;
    if (end && v > end) return false;
    return true;
  });
}

function filterRowsByAdvanced(rows) {
  const selectedFields = filterState.fields || [];

  return rows.filter(row => {
    const rowMethod = row.workType === "除草剤散布"
      ? String(row.sprayMethod || "").trim()
      : String(row.mowingMethod || "").trim();

    const rowFields = String(row.fieldText || "").split("／").map(v => v.trim()).filter(Boolean);

    const matched = matchesSharedListFilters({
      selectedFields,
      selectedMethod: state.method,
      keyword: state.keyword,
      rowFields,
      rowMethod,
      searchValues: [
        row.workType,
        row.fieldText,
        row.workers,
        row.pesticides,
        row.sprayMethod,
        row.mowingMethod,
        row.notes
      ]
    });

    if (!matched) return false;

    if (row.workType === "除草剤散布" && state.pesticide && !rowContainsPesticide(row, state.pesticide)) return false;

    return true;
  });
}

function getMethodCandidatesByMode(mode, rows) {
  if (mode === "spray") {
    return collectUniqueMethods(rows, r => r.sprayMethod);
  }
  return collectUniqueMethods(rows, r => r.mowingMethod);
}

function collectPesticideNames(rows) {
  const names = new Set();

  rows.forEach(row => {
    (Array.isArray(row.pesticideUsage) ? row.pesticideUsage : []).forEach(u => {
      const n = String(u?.name || "").trim();
      if (n) names.add(n);
    });

    String(row.pesticides || "").split("／").map(v => v.trim()).filter(Boolean).forEach(n => names.add(n));
  });

  return [...names].sort((a, b) => a.localeCompare(b, "ja"));
}

function syncMethodFilterOptions() {
  const select = document.getElementById("filter-method");
  if (!select) return;

  const modeRows = state.items.filter(MODES[state.mode].match);
  const unique = getMethodCandidatesByMode(state.mode, modeRows);

  if (state.method && !unique.includes(state.method)) {
    state.method = "";
  }

  const title = state.mode === "spray" ? "除草方式" : "草刈り方式";
  select.innerHTML = [
    `<option value="">${title}を選択（全件）</option>`,
    ...unique.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`)
  ].join("");
  select.value = state.method;
}

function syncPesticideFilterOptions(rows) {
  const select = document.getElementById("filter-pesticide");
  if (!select) return;

  if (state.mode !== "spray") {
    state.pesticide = "";
    select.innerHTML = '<option value="">農薬を選択（除草剤散布で利用）</option>';
    select.value = "";
    select.disabled = true;
    return;
  }

  const unique = collectPesticideNames(rows);
  if (state.pesticide && !unique.includes(state.pesticide)) {
    state.pesticide = "";
  }

  select.innerHTML = [
    '<option value="">農薬を選択（全件）</option>',
    ...unique.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`)
  ].join("");
  select.value = state.pesticide;
  select.disabled = false;
}

function renderModeUi(filteredCount) {
  const sprayBtn = document.getElementById("mode-spray");
  const mowingBtn = document.getElementById("mode-mowing");
  const note = document.getElementById("mode-note");

  if (sprayBtn) sprayBtn.classList.toggle("active", state.mode === "spray");
  if (mowingBtn) mowingBtn.classList.toggle("active", state.mode === "mowing");

  if (note) {
    note.textContent = `${MODES[state.mode].note}（${filteredCount}件）`;
  }
}

function parseFieldNames(fieldText) {
  return String(fieldText || "")
    .split("／")
    .map(v => v.trim())
    .filter(Boolean);
}

function formatNumber(value, digits = 1) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return "-";
  return n.toLocaleString("ja-JP", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function sumTotalWaterFromUsage(usageRows) {
  return (usageRows || []).reduce((sum, u) => sum + Number(u?.total_water_amount || 0), 0);
}

function buildSprayAggregateSummary(row) {
  const usageRows = Array.isArray(row.pesticideUsage) ? row.pesticideUsage : [];
  const names = usageRows.map(u => String(u?.name || "").trim()).filter(Boolean);
  const dilution = usageRows.map(u => {
    const name = String(u?.name || "").trim();
    const rate = Number(u?.dilution_rate || 0);
    if (!name || !rate) return "";
    return `${name}: ${rate}倍`;
  }).filter(Boolean).join(" / ");

  const spray = usageRows.map(u => {
    const name = String(u?.name || "").trim();
    const total = Number(u?.total_water_amount || 0);
    if (!name) return "";
    return `${name}: ${formatNumber(total, 1)}L`;
  }).filter(Boolean).join(" / ");

  const fields = parseFieldNames(row.fieldText);
  const totalAreaA = fields.reduce((sum, f) => sum + Number(state.fieldAreaMap[f] || 0), 0);
  const totalWater = sumTotalWaterFromUsage(usageRows);
  const per10a = totalAreaA > 0 ? (totalWater / totalAreaA) * 10 : 0;

  return {
    names: names.length ? [...new Set(names)].join("／") : (row.pesticides || "-"),
    dilution: dilution || "-",
    spray: spray || "-",
    per10a: totalAreaA > 0 ? `${formatNumber(per10a, 1)} L/10a` : "-"
  };
}

function buildSprayFieldRows(rows) {
  const out = [];

  rows.forEach(row => {
    const distributed = Array.isArray(row.distributed) ? row.distributed : [];
    if (!distributed.length) {
      const fieldName = row.fieldText;
      out.push({
        ...row,
        fieldName,
        pesticideName: row.pesticides || "-",
        dilutionRate: "-",
        waterAmount: "-",
        per10a: "-"
      });
      return;
    }

    distributed.forEach(d => {
      const dilution = Number(d?.dilution_rate || 0);
      const water = Number(d?.water_amount ?? d?.spray_amount ?? 0);
      const fieldName = String(d?.field || "").trim() || row.fieldText;
      const areaA = Number(state.fieldAreaMap[fieldName] || 0);
      const per10a = areaA > 0 && Number.isFinite(water) ? (water / areaA) * 10 : 0;
      out.push({
        ...row,
        fieldName,
        pesticideName: String(d?.name || "").trim() || "-",
        dilutionRate: dilution ? `${dilution}倍` : "-",
        waterAmount: Number.isFinite(water) ? `${formatNumber(water, 1)}L` : "-",
        per10a: areaA > 0 && Number.isFinite(water) ? `${formatNumber(per10a, 1)}L/10a` : "-"
      });
    });
  });

  return out;
}

function filterSprayFieldRows(rows) {
  const keyword = state.keyword.toLowerCase();
  const selectedFields = filterState.fields || [];

  return rows.filter(row => {
    const fieldName = String(row.fieldName || "").trim();
    if (selectedFields.length > 0 && !selectedFields.includes(fieldName)) {
      return false;
    }

    const sprayMethod = String(row.sprayMethod || "").trim();
    if (state.method && sprayMethod !== state.method) {
      return false;
    }

    const pesticideName = String(row.pesticideName || "").trim();
    if (state.pesticide) {
      const names = pesticideName.split("／").map(v => v.trim()).filter(Boolean);
      if (!names.includes(state.pesticide)) return false;
    }

    if (keyword) {
      const hay = [
        row.workType,
        row.fieldName,
        row.pesticideName,
        row.dilutionRate,
        row.waterAmount,
        row.sprayMethod,
        row.workers,
        row.notes
      ].map(v => String(v || "").toLowerCase()).join(" ");
      if (!hay.includes(keyword)) return false;
    }

    return true;
  });
}

function parseWaterText(value) {
  const text = String(value || "").replace(/[^0-9.\-]/g, "");
  const n = Number(text);
  return Number.isFinite(n) ? n : 0;
}

function calcAreaFromAggregateRows(rows) {
  return rows.reduce((sum, row) => {
    const names = parseFieldNames(row.fieldText);
    const areaA = names.reduce((s, f) => s + Number(state.fieldAreaMap[f] || 0), 0);
    return sum + areaA;
  }, 0);
}

function calcAreaFromFieldRows(rows) {
  const seen = new Set();
  let total = 0;

  rows.forEach(row => {
    const fieldName = String(row.fieldName || "").trim();
    if (!fieldName) return;
    const key = [row.date, row.workers, row.notes, row.sprayMethod, fieldName].join("||");
    if (seen.has(key)) return;
    seen.add(key);
    total += Number(state.fieldAreaMap[fieldName] || 0);
  });

  return total;
}

function aggregatePesticideTotalsFromRows(rows, isFieldView) {
  const totals = new Map();

  if (isFieldView) {
    rows.forEach(row => {
      const name = String(row.pesticideName || "").trim();
      if (!name || name === "-") return;
      const water = parseWaterText(row.waterAmount);
      if (!totals.has(name)) totals.set(name, { water: 0, count: 0 });
      const curr = totals.get(name);
      curr.water += water;
      curr.count += 1;
    });
    return totals;
  }

  rows.forEach(row => {
    const usageRows = Array.isArray(row.pesticideUsage) ? row.pesticideUsage : [];
    if (usageRows.length) {
      usageRows.forEach(u => {
        const name = String(u?.name || "").trim();
        if (!name) return;
        if (state.pesticide && name !== state.pesticide) return;
        const water = Number(u?.total_water_amount || 0);
        if (!totals.has(name)) totals.set(name, { water: 0, count: 0 });
        const curr = totals.get(name);
        curr.water += water;
        curr.count += 1;
      });
      return;
    }

    (Array.isArray(row.distributed) ? row.distributed : []).forEach(u => {
      const name = String(u?.name || "").trim();
      if (!name) return;
      if (state.pesticide && name !== state.pesticide) return;
      const water = Number(u?.water_amount ?? u?.spray_amount ?? 0);
      if (!totals.has(name)) totals.set(name, { water: 0, count: 0 });
      const curr = totals.get(name);
      curr.water += water;
      curr.count += 1;
    });
  });

  return totals;
}

function renderSprayMetrics({ aggregateRows = [], fieldRows = [], isFieldView = false }) {
  const metricsBox = document.getElementById("spray-metrics");
  const summaryBox = document.getElementById("pesticide-summary");
  const areaEl = document.getElementById("metric-area-total");
  const waterEl = document.getElementById("metric-water-total");
  const per10aEl = document.getElementById("metric-per10a");

  if (!metricsBox || !summaryBox || !areaEl || !waterEl || !per10aEl) return;

  const areaA = isFieldView ? calcAreaFromFieldRows(fieldRows) : calcAreaFromAggregateRows(aggregateRows);

  if (state.mode === "mowing") {
    areaEl.textContent = `${formatNumber(areaA / 10, 2)}反`;
    waterEl.textContent = "-";
    per10aEl.textContent = "-";
    metricsBox.classList.add("active");
    summaryBox.classList.remove("active");
    summaryBox.textContent = "";
    return;
  }

  if (state.mode !== "spray") {
    metricsBox.classList.remove("active");
    summaryBox.classList.remove("active");
    summaryBox.textContent = "";
    return;
  }

  const pesticideTotals = aggregatePesticideTotalsFromRows(isFieldView ? fieldRows : aggregateRows, isFieldView);
  const totalWater = [...pesticideTotals.values()].reduce((sum, v) => sum + Number(v.water || 0), 0);
  const per10a = areaA > 0 ? (totalWater / areaA) * 10 : 0;

  areaEl.textContent = `${formatNumber(areaA / 10, 2)}反`;
  waterEl.textContent = `${formatNumber(totalWater, 1)}L`;
  per10aEl.textContent = areaA > 0 ? `${formatNumber(per10a, 1)}L/10a` : "-";
  metricsBox.classList.add("active");

  const lines = [...pesticideTotals.entries()]
    .sort((a, b) => b[1].water - a[1].water)
    .map(([name, v]) => `${escapeHtml(name)}: ${formatNumber(v.water, 1)}L（${v.count}件）`);

  if (lines.length) {
    summaryBox.innerHTML = `薬剤別合計: ${lines.join(" / ")}`;
    summaryBox.classList.add("active");
  } else {
    summaryBox.textContent = "";
    summaryBox.classList.remove("active");
  }
}

function renderPeriodSummary(rows) {
  const summaryEl = document.getElementById("period-summary");
  if (!summaryEl) return;

  summaryEl.innerHTML = buildPeriodCountSummaryHtml({
    rows,
    periodStart: state.periodStart,
    periodEnd: state.periodEnd,
    getDate: row => row?.date
  });
}

function buildAreaSourceRows(modeItems) {
  if (state.mode === "spray") {
    return filterSprayFieldRows(buildSprayFieldRows(modeItems)).map(row => ({
      field: String(row.fieldName || "").trim(),
      date: String(row.date || "").trim(),
      dateValue: toDateValue(row.date),
      workType: String(row.sprayMethod || "").trim() || "除草剤散布"
    })).filter(row => row.field && row.date && row.dateValue);
  }

  const rows = filterRowsByAdvanced(modeItems);
  const out = [];

  rows.forEach(row => {
    const date = String(row.date || "").trim();
    const dateValue = toDateValue(date);
    const workType = String(row.mowingMethod || "").trim() || "草刈り";

    parseFieldNames(row.fieldText).forEach(field => {
      if (!field || !date || !dateValue) return;
      out.push({ field, date, dateValue, workType });
    });
  });

  return out;
}

function renderAreaList(modeItems) {
  const container = document.getElementById("weeding-area-list");
  if (!container) return;

  const selectedFields = filterState.fields || [];
  const targetFields = selectedFields.length > 0
    ? state.fieldsData.filter(f => selectedFields.includes(f.name))
    : state.fieldsData;

  if (!targetFields.length) {
    container.innerHTML = '<div class="empty-box">表示対象の圃場がありません。</div>';
    return;
  }

  const areaRows = buildAreaSourceRows(modeItems);
  const model = buildAreaLatestModel({
    fields: targetFields,
    rows: areaRows,
    periodStart: state.periodStart,
    periodEnd: state.periodEnd,
    areaSort: state.areaSort,
    todayValue: getTodayValue(),
    getField: row => row.field,
    getDate: row => row.date,
    getDateValue: row => row.dateValue,
    getWorkType: row => row.workType
  });

  if (!model.areaEntries.length) {
    container.innerHTML = '<div class="empty-box">該当する圃場がありません。</div>';
    return;
  }

  container.innerHTML = model.areaEntries.map(area => {
    const groupMeta = getAreaStatusMeta(area.groupStatus);
    return `
      <details class="area-group ${groupMeta.className}">
        <summary class="area-title">
          <div class="area-title-main">
            <h3>${escapeHtml(area.areaName)}</h3>
            <span class="area-badge ${groupMeta.className}">${groupMeta.label}</span>
            <span class="pill pill-count">全体${area.countAll}件</span>
            <span class="pill pill-date">期間内${area.inPeriodCount}件</span>
            ${area.outPeriodCount > 0 ? `<span class="pill pill-out">期間外${area.outPeriodCount}圃場</span>` : ""}
          </div>
          <div class="area-sub">${escapeHtml(model.startLabel)}〜${escapeHtml(model.endLabel)} / 最終: ${escapeHtml(area.latestDate || "未記録")}</div>
        </summary>

        <div class="field-list">
          ${area.cards.map(card => renderAreaFieldCard(card)).join("")}
        </div>
      </details>
    `;
  }).join("");
}

function renderAreaFieldCard(card) {
  const statusMeta = getAreaStatusMeta(card.status);
  const detailLink = `/fields/index.html?field=${encodeURIComponent(card.field)}`;

  return `
    <article class="field-card ${statusMeta.className}">
      <div class="field-name">
        <h4><a href="${detailLink}">${escapeHtml(card.field)}</a></h4>
        <span class="field-area ${statusMeta.className}">${escapeHtml(card.area || "圃場")}</span>
        <span class="status-chip ${statusMeta.className}">${statusMeta.label}</span>
      </div>
      <div class="field-meta">
        <div class="field-meta-line">
          <span class="pill pill-date">最終作業: ${escapeHtml(card.latestDate || "未記録")}</span>
          <span class="pill pill-count">全体: ${card.countAll}件</span>
          <span class="pill pill-date">期間内: ${card.countInPeriod}件</span>
        </div>
        <div class="age-chip ${statusMeta.className}">${card.latestAgeDays === null ? "未記録" : `最終作業から ${escapeHtml(formatDaysAgo(card.latestAgeDays))}`}</div>
        <div>直近: ${escapeHtml(card.latestWorkType || "未記録")}</div>
        <div>前回との差: ${escapeHtml(card.latestGapLabel || "初回")}</div>
      </div>
    </article>
  `;
}

function render() {
  const container = document.getElementById("weeding-container");
  container.innerHTML = "";

  const isSpray = state.mode === "spray";
  const modeDef = MODES[state.mode];
  const modeItems = state.items.filter(modeDef.match);
  renderAreaList(modeItems);
  const periodItems = filterRowsByPeriod(modeItems);

  syncMethodFilterOptions();
  syncPesticideFilterOptions(periodItems);

  const items = filterRowsByAdvanced(periodItems);

  let sprayFieldRows = [];
  if (isSpray) {
    sprayFieldRows = filterSprayFieldRows(buildSprayFieldRows(periodItems))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    renderModeUi(sprayFieldRows.length);
    renderPeriodSummary(sprayFieldRows);
    renderSprayMetrics({ fieldRows: sprayFieldRows, isFieldView: true });
    if (!sprayFieldRows.length) {
      container.innerHTML = '<div class="empty-box">記録がありません。</div>';
      return;
    }
  } else {
    renderModeUi(items.length);
    renderPeriodSummary(items);
    renderSprayMetrics({ aggregateRows: items, isFieldView: false });
    if (!items.length) {
      container.innerHTML = '<div class="empty-box">記録がありません。</div>';
      return;
    }
  }

  const today = getTodayValue();

  const list = [...items].sort((a, b) => String(b.date).localeCompare(String(a.date)));

  let html = `
    <section class="list-card">
      <div class="list-head">
        <h2 class="page-title">記録一覧</h2>
        <p>期間条件に一致する記録を新しい順で表示しています。</p>
      </div>
      <div class="log-scroll">
        <table class="weed-table">
  `;
  if (isSpray) {
    html += `
      <thead>
        <tr>
          <th>日付</th>
          <th>直近</th>
          <th>圃場</th>
          <th>使用農薬</th>
          <th>倍率</th>
          <th>散布水量（L）</th>
          <th>散布水量/10a</th>
          <th>除草方式</th>
          <th>作業者</th>
          <th>備考</th>
        </tr>
      </thead>
      <tbody>
    `;

    sprayFieldRows.forEach(r => {
      const sprayMethod = String(r.sprayMethod || "").trim() || "-";
      const days = Math.max(0, Math.round((today - toDateValue(r.date)) / 86400000));
      const cls = ageClass(days);
      html += `
        <tr>
          <td>${escapeHtml(r.date)}</td>
          <td><span class="recent-badge ${cls}">${escapeHtml(formatDaysAgo(days))}</span></td>
          <td>${escapeHtml(r.fieldName)}</td>
          <td>${escapeHtml(r.pesticideName)}</td>
          <td>${escapeHtml(r.dilutionRate)}</td>
          <td>${escapeHtml(r.waterAmount)}</td>
          <td>${escapeHtml(r.per10a)}</td>
          <td>${escapeHtml(sprayMethod)}</td>
          <td>${escapeHtml(r.workers || "-")}</td>
          <td>${escapeHtml(r.notes || "")}</td>
        </tr>
      `;
    });
  } else {
    html += `
      <thead>
        <tr>
          <th>日付</th>
          <th>直近</th>
          <th>圃場</th>
          <th>草刈り方式</th>
          <th>機械</th>
          <th>作業者</th>
          <th>備考</th>
        </tr>
      </thead>
      <tbody>
    `;

    list.forEach(r => {
      const machineLabel = String(r.machine || "").trim() || "-";
      const days = Math.max(0, Math.round((today - toDateValue(r.date)) / 86400000));
      const cls = ageClass(days);
      html += `
        <tr>
          <td>${escapeHtml(r.date)}</td>
          <td><span class="recent-badge ${cls}">${escapeHtml(formatDaysAgo(days))}</span></td>
          <td>${escapeHtml(r.fieldText)}</td>
          <td>${escapeHtml(r.mowingMethod || "-")}</td>
          <td>${escapeHtml(machineLabel)}</td>
          <td>${escapeHtml(r.workers || "-")}</td>
          <td>${escapeHtml(r.notes || "")}</td>
        </tr>
      `;
    });
  }

  html += `</tbody></table></div></section>`;

  container.innerHTML = html;
}

export async function initWeedingList() {
  setupSmartBackButton({
    elementId: "weeding-back-btn",
    fallbackPath: "/field/weeding/index.html",
    logInputPath: "/field/weeding/index.html",
    logInputLabel: "除草・草刈りログへ戻る"
  });

  state.mode = getModeFromUrl();
  const defaults = getDefaultPeriodRange();
  state.periodStart = defaults.start;
  state.periodEnd = defaults.end;
  bindModeButtons();
  bindAreaSortControl();
  bindPeriodControls();
  state.items = await loadAllWeedingLogs();

  const [fieldsData, fieldDetail] = await Promise.all([
    loadJSON("/data/fields.json?v=1"),
    loadJSON("/data/field-detail.json?v=1").catch(() => ({}))
  ]);

  const parents = [];
  const children = {};
  state.fieldsData = fieldsData || [];
  (fieldsData || []).forEach(f => {
    if (!f || !f.area || !f.name) return;
    if (!children[f.area]) {
      children[f.area] = [];
      parents.push(f.area);
    }
    children[f.area].push(f.name);
  });

  state.fieldAreaMap = Object.fromEntries((fieldsData || []).map(field => {
    const sizeA = Number(fieldDetail?.[field?.name]?.size || 0);
    return [field?.name, Number.isFinite(sizeA) ? sizeA : 0];
  }));

  setFilterData({
    fields: { parents, children }
  });

  filterState.fields = [];
  initActiveFilterUI();
  bindFilterControls();
  render();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
