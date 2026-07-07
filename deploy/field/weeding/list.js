import { loadAllWeedingLogs } from "./list-utils.js?v=1";
import { loadJSON } from "/common/json.js?v=1";
import { openFieldModal } from "/common/filter/filter-field.js?v=1";
import { setFilterData, filterState } from "/common/filter/filter-core.js?v=1";
import { initActiveFilterUI } from "/common/filter/filter-active.js?v=1";

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
  sprayView: "aggregate",
  periodStart: "",
  periodEnd: "",
  keyword: "",
  method: "",
  fieldAreaMap: {}
};

function formatDateISO(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getDefaultPeriodRange() {
  const end = new Date();
  const start = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  start.setMonth(start.getMonth() - 1);
  return {
    start: formatDateISO(start),
    end: formatDateISO(end)
  };
}

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

function bindSprayViewButtons() {
  const aggregateBtn = document.getElementById("spray-view-aggregate");
  const fieldBtn = document.getElementById("spray-view-field");

  if (aggregateBtn) {
    aggregateBtn.onclick = () => {
      if (state.sprayView === "aggregate") return;
      state.sprayView = "aggregate";
      render();
    };
  }

  if (fieldBtn) {
    fieldBtn.onclick = () => {
      if (state.sprayView === "field") return;
      state.sprayView = "field";
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

function bindFilterControls() {
  const fieldBtn = document.getElementById("open-field-modal");
  const methodSelect = document.getElementById("filter-method");
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
      if (methodSelect) methodSelect.value = "";
      if (keywordInput) keywordInput.value = "";
      window.dispatchEvent(new CustomEvent("filter:apply"));
      render();
    });
  }

  window.addEventListener("filter:apply", () => render());
  window.addEventListener("filter:reset", () => render());
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
  const keyword = state.keyword.toLowerCase();
  const selectedFields = filterState.fields || [];

  return rows.filter(row => {
    if (selectedFields.length > 0) {
      const fields = String(row.fieldText || "").split("／").map(v => v.trim());
      if (!selectedFields.some(f => fields.includes(f))) return false;
    }

    const rowMethod = row.workType === "除草剤散布"
      ? String(row.sprayMethod || "").trim()
      : String(row.mowingMethod || "").trim();

    if (state.method && rowMethod !== state.method) return false;

    if (keyword) {
      const hay = [
        row.workType,
        row.fieldText,
        row.workers,
        row.pesticides,
        row.sprayMethod,
        row.mowingMethod,
        row.notes
      ].map(v => String(v || "").toLowerCase()).join(" ");
      if (!hay.includes(keyword)) return false;
    }

    return true;
  });
}

function getMethodCandidatesByMode(mode, rows) {
  if (mode === "spray") {
    return rows.map(r => String(r.sprayMethod || "").trim()).filter(Boolean);
  }
  return rows.map(r => String(r.mowingMethod || "").trim()).filter(Boolean);
}

function syncMethodFilterOptions() {
  const select = document.getElementById("filter-method");
  if (!select) return;

  const modeRows = state.items.filter(MODES[state.mode].match);
  const unique = [...new Set(getMethodCandidatesByMode(state.mode, modeRows))]
    .sort((a, b) => a.localeCompare(b, "ja"));

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

function renderModeUi(filteredCount) {
  const sprayBtn = document.getElementById("mode-spray");
  const mowingBtn = document.getElementById("mode-mowing");
  const note = document.getElementById("mode-note");
  const sprayViewRow = document.getElementById("spray-view-row");
  const aggregateBtn = document.getElementById("spray-view-aggregate");
  const fieldBtn = document.getElementById("spray-view-field");

  if (sprayBtn) sprayBtn.classList.toggle("active", state.mode === "spray");
  if (mowingBtn) mowingBtn.classList.toggle("active", state.mode === "mowing");

  if (sprayViewRow) sprayViewRow.classList.toggle("active", state.mode === "spray");
  if (aggregateBtn) aggregateBtn.classList.toggle("active", state.sprayView === "aggregate");
  if (fieldBtn) fieldBtn.classList.toggle("active", state.sprayView === "field");

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
      out.push({
        ...row,
        fieldName: row.fieldText,
        pesticideName: row.pesticides || "-",
        dilutionRate: "-",
        waterAmount: "-"
      });
      return;
    }

    distributed.forEach(d => {
      const dilution = Number(d?.dilution_rate || 0);
      const water = Number(d?.water_amount ?? d?.spray_amount ?? 0);
      out.push({
        ...row,
        fieldName: String(d?.field || "").trim() || row.fieldText,
        pesticideName: String(d?.name || "").trim() || "-",
        dilutionRate: dilution ? `${dilution}倍` : "-",
        waterAmount: Number.isFinite(water) ? `${formatNumber(water, 1)}L` : "-"
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

function renderPeriodSummary(rows) {
  const summaryEl = document.getElementById("period-summary");
  if (!summaryEl) return;

  const recent = { fresh: 0, warm: 0, old: 0 };
  const today = getTodayValue();

  rows.forEach(row => {
    const days = Math.max(0, Math.round((today - toDateValue(row.date)) / 86400000));
    recent[ageClass(days)] += 1;
  });

  summaryEl.innerHTML = `表示件数 <strong>${rows.length}</strong> 件 / 直近: <strong>${recent.fresh}</strong> 件 / 中間: <strong>${recent.warm}</strong> 件 / 旧: <strong>${recent.old}</strong> 件`;
}

function render() {
  const container = document.getElementById("weeding-container");
  container.innerHTML = "";

  syncMethodFilterOptions();

  const isSpray = state.mode === "spray";
  const isSprayFieldView = isSpray && state.sprayView === "field";
  const modeDef = MODES[state.mode];
  const modeItems = state.items.filter(modeDef.match);
  const periodItems = filterRowsByPeriod(modeItems);
  const items = filterRowsByAdvanced(periodItems);

  let sprayFieldRows = [];
  if (isSprayFieldView) {
    sprayFieldRows = filterSprayFieldRows(buildSprayFieldRows(periodItems))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    renderModeUi(sprayFieldRows.length);
    renderPeriodSummary(sprayFieldRows);
    if (!sprayFieldRows.length) {
      container.innerHTML = '<div class="empty-box">記録がありません。</div>';
      return;
    }
  } else {
    renderModeUi(items.length);
    renderPeriodSummary(items);
    if (!items.length) {
      container.innerHTML = '<div class="empty-box">記録がありません。</div>';
      return;
    }
  }

  const today = getTodayValue();

  const list = [...items].sort((a, b) => String(b.date).localeCompare(String(a.date)));

  let html = `<div class="list-card"><table class="weed-table">`;
  if (isSpray && state.sprayView === "aggregate") {
    html += `
      <thead>
        <tr>
          <th>日付</th>
          <th>直近</th>
          <th>圃場</th>
          <th>使用農薬</th>
          <th>倍率</th>
          <th>散布液量</th>
          <th>10a換算</th>
          <th>除草方式</th>
          <th>作業者</th>
          <th>備考</th>
        </tr>
      </thead>
      <tbody>
    `;

    list.forEach(r => {
      const sprayMethod = String(r.sprayMethod || "").trim() || "-";
      const days = Math.max(0, Math.round((today - toDateValue(r.date)) / 86400000));
      const cls = ageClass(days);
      const spray = buildSprayAggregateSummary(r);
      html += `
        <tr>
          <td>${escapeHtml(r.date)}</td>
          <td><span class="recent-badge ${cls}">${escapeHtml(formatDaysAgo(days))}</span></td>
          <td>${escapeHtml(r.fieldText)}</td>
          <td>${escapeHtml(spray.names)}</td>
          <td>${escapeHtml(spray.dilution)}</td>
          <td>${escapeHtml(spray.spray)}</td>
          <td>${escapeHtml(spray.per10a)}</td>
          <td>${escapeHtml(sprayMethod)}</td>
          <td>${escapeHtml(r.workers || "-")}</td>
          <td>${escapeHtml(r.notes || "")}</td>
        </tr>
      `;
    });
  } else if (isSpray && state.sprayView === "field") {
    html += `
      <thead>
        <tr>
          <th>日付</th>
          <th>直近</th>
          <th>圃場</th>
          <th>使用農薬</th>
          <th>倍率</th>
          <th>圃場別散布量</th>
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

  html += `</tbody></table></div>`;

  container.innerHTML = html;
}

export async function initWeedingList() {
  state.mode = getModeFromUrl();
  const defaults = getDefaultPeriodRange();
  state.periodStart = defaults.start;
  state.periodEnd = defaults.end;
  bindModeButtons();
  bindSprayViewButtons();
  bindPeriodControls();
  state.items = await loadAllWeedingLogs();

  const [fieldsData, fieldDetail] = await Promise.all([
    loadJSON("/data/fields.json?v=1"),
    loadJSON("/data/field-detail.json?v=1").catch(() => ({}))
  ]);

  const parents = [];
  const children = {};
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
