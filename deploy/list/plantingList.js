// ===============================
// plantingList.js（定植ベース一覧）
// ===============================

import { loadCSV, normalizeKeys } from "/common/csv.js?v=20260821-quote-fix";
import { loadJSON } from "/common/json.js";
import { calcAreaM2, calcAreaTan } from "/fields/analysis-utils.js";
import { todayLocalYmd } from "/common/date-utils.js?v=1";

import {
  openYearModal,
  openFieldModal,
  openVarietyModal,
  setFilterData,
  getFilterState,
  setFilterState
} from "/common/filter.js";

import { showInfoModal } from "/common/showInfoModal.js";

let plantingRows = [];
let seedRows = [];
let harvestRows = [];
let fieldData = [];
let varietyData = [];
let canDiscard = false;
let harvestStartDateMap = {};

let filterData = {};
let initialized = false;
let plantDateSortOrder = null; // null | asc | desc

// 定植後の管理作業（圃場別に日付昇順で保持）
// pesticide: 最終実施からの経過日数で判定 / intertill: 定植からの予定日で判定
const MANAGEMENT_WORK_TYPES = [
  { type: "pesticide", label: "防除", csv: "/logs/pesticide/all.csv", warnDays: 14, alertDays: 21 },
  { type: "intertill", label: "中耕", csv: "/logs/intertill/all.csv", scheduleDays: [14, 28] },
  { type: "fertilizer", label: "施肥", csv: "/logs/fertilizer/all.csv" },
  { type: "weeding", label: "除草", csv: "/logs/weeding/all.csv" },
  { type: "watering", label: "かん水", csv: "/logs/watering/all.csv" }
];

let managementLogsByField = new Map();
const fieldLogCache = new Map();

export async function renderPlantingList() {
  if (!initialized) {
    await initPlantingListPage();
    initialized = true;
  }
  const state = window.currentFilterState || {};
  const filtered = applyAllFilters(plantingRows, state);
  renderTable(filtered);
}

async function initPlantingListPage() {

  if (window.currentRole === "admin") canDiscard = true;

  plantingRows = normalizeKeys(await loadCSV("/logs/planting/all.csv"));
  seedRows = normalizeKeys(await loadCSV("/logs/seed/all.csv"));
  harvestRows = normalizeKeys(await loadCSV("/logs/harvest/all.csv").catch(() => []));

  fieldData = await loadJSON("/data/fields.json");
  varietyData = await loadJSON("/data/varieties.json");
  harvestStartDateMap = buildHarvestStartDateMap(harvestRows);
  managementLogsByField = await loadManagementLogs();

  const ymMap = {};
  plantingRows.forEach(r => {
    if (!r.plantDate) return;
    const y = r.plantDate.slice(0, 4);
    const m = r.plantDate.slice(5, 7);
    if (!ymMap[y]) ymMap[y] = [];
    if (!ymMap[y].includes(m)) ymMap[y].push(m);
  });
  Object.keys(ymMap).forEach(y => ymMap[y].sort());

  const areaMap = {};
  const areaOrder = [];
  fieldData.forEach(f => {
    if (!areaMap[f.area]) {
      areaMap[f.area] = [];
      areaOrder.push(f.area);
    }
    areaMap[f.area].push(f.name);
  });

  const typeMap = {};
  const typeOrder = [];
  varietyData.forEach(v => {
    if (!typeMap[v.type]) {
      typeMap[v.type] = [];
      typeOrder.push(v.type);
    }
    typeMap[v.type].push(v.name);
  });

  filterData = {
    years: Object.keys(ymMap).sort(),
    months: ymMap,
    fields: { parents: areaOrder, children: areaMap },
    varieties: { parents: typeOrder, children: typeMap }
  };

  setFilterData(filterData);
  window.plantingFilterData = filterData;

  document.querySelector('[data-type="year"]').addEventListener("click", openYearModal);
  document.querySelector('[data-type="field"]').addEventListener("click", openFieldModal);
  document.querySelector('[data-type="variety"]').addEventListener("click", openVarietyModal);

  window.addEventListener("filter:apply", (e) => {
    if (window.currentListMode !== "planting") return;  // ★ 追加
    window.currentFilterState = e.detail;
    renderTable(applyAllFilters(plantingRows, e.detail));
  });

  window.addEventListener("filter:reset", () => {
    if (window.currentListMode !== "planting") return;  // ★ 追加
    window.currentFilterState = {};
    renderTable(plantingRows);
  });

  applyDefaultSeasonFilterIfNeeded(ymMap);
}

function applyDefaultSeasonFilterIfNeeded(ymMap) {
  const current = getFilterState();
  const alreadySelected =
    current.yearMonths.length > 0 ||
    current.fields.length > 0 ||
    current.varieties.length > 0;
  if (alreadySelected) return;

  const now = new Date();
  const baseYear = now.getFullYear();

  const targets = [];
  for (let m = 7; m <= 12; m += 1) {
    targets.push(`${baseYear}-${String(m).padStart(2, "0")}`);
  }
  for (let m = 1; m <= 3; m += 1) {
    targets.push(`${baseYear + 1}-${String(m).padStart(2, "0")}`);
  }

  const available = new Set(
    Object.entries(ymMap || {}).flatMap(([year, months]) =>
      (months || []).map(month => `${year}-${month}`)
    )
  );

  const matched = targets.filter(ym => available.has(ym));
  if (!matched.length) return;

  window.currentFilterState = {
    ...(window.currentFilterState || {}),
    yearMonths: [...matched],
    fields: [],
    varieties: []
  };

  setFilterState({ yearMonths: matched, fields: [], varieties: [] }, { apply: true });
}

function applyAllFilters(rows, state) {

  let result = rows;

  if (state.yearMonths?.length) {
    result = result.filter(r => {
      const y = r.plantDate?.slice(0, 4);
      const m = r.plantDate?.slice(5, 7);
      return state.yearMonths.includes(`${y}-${m}`);
    });
  }

  if (state.fields?.length) {
    result = result.filter(r => state.fields.includes(r.field));
  }

  if (state.varieties?.length) {
    result = result.filter(r => state.varieties.includes(r.variety));
  }

  return result;
}

function getSeedDates(seedRef) {
  const refs = parseSeedRefs(seedRef);
  if (!refs.length) return "";

  const dates = refs.map(ref => {
    const row = seedRows.find(s => normalizeRef(s.seedRef) === ref);
    return row?.seedDate ?? "";
  });

  return dates.filter(d => d).join("<br>");
}

function normalizeRef(value) {
  return String(value ?? "").replace(/\s+/g, "").trim();
}

function parseSeedRefs(value) {
  return String(value ?? "")
    .split(/[\/,]/)
    .map(normalizeRef)
    .filter(Boolean);
}

function parseYmdToUtcDate(value) {
  const text = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [y, m, d] = text.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function diffDays(startDate, endDate) {
  if (!(startDate instanceof Date) || !(endDate instanceof Date)) return null;
  const ms = endDate.getTime() - startDate.getTime();
  return Math.floor(ms / 86400000);
}

function buildHarvestStartDateMap(rows) {
  const map = {};
  (Array.isArray(rows) ? rows : []).forEach(row => {
    const ref = String(row?.plantingRef ?? "").trim();
    const date = parseYmdToUtcDate(row?.harvestDate);
    if (!ref || !date) return;

    if (!map[ref] || date < map[ref]) {
      map[ref] = date;
    }
  });
  return map;
}

function getNurseryDays(seedRef, plantDate) {
  const plant = parseYmdToUtcDate(plantDate);
  if (!plant) return "-";

  const refs = parseSeedRefs(seedRef);
  if (!refs.length) return "-";

  const dayList = refs
    .map(ref => seedRows.find(s => normalizeRef(s.seedRef) === ref)?.seedDate)
    .map(parseYmdToUtcDate)
    .map(seedDate => diffDays(seedDate, plant))
    .filter(days => Number.isFinite(days) && days >= 0);

  if (!dayList.length) return "-";

  const min = Math.min(...dayList);
  const max = Math.max(...dayList);
  if (min === max) return `${min}日`;
  return `${min}〜${max}日`;
}

function getPostPlantingDays(plantDate, plantingRef) {
  const plant = parseYmdToUtcDate(plantDate);
  if (!plant) return "-";

  const ref = String(plantingRef ?? "").trim();
  const harvestStart = ref ? harvestStartDateMap[ref] : null;

  if (harvestStart instanceof Date) {
    const days = diffDays(plant, harvestStart);
    if (!Number.isFinite(days)) return "-";
    return `${days}日で収穫`;
  }

  const today = parseYmdToUtcDate(todayLocalYmd());
  if (!(today instanceof Date)) return "-";
  const elapsed = diffDays(plant, today);
  if (!Number.isFinite(elapsed)) return "-";
  return `${elapsed}日経過`;
}

function getPlantDetail(plantingRef) {
  const row = plantingRows.find(r => r.plantingRef === plantingRef);
  if (!row) {
    return {
      title: "データなし",
      html: "<p>該当データがありません。</p>"
    };
  }

  return {
    title: `定植情報：${plantingRef}`,
    html: `
      <p><b>株数：</b>${row.quantity}</p>
      <p><b>株間：</b>${row.spacingRow} cm</p>
      <p><b>畝間：</b>${row.spacingBed} cm</p>
      <p><b>トレイ種別：</b>${row.trayType}</p>
      <p><b>収穫予定：</b>${row.harvestPlanYM ?? ""}</p>
      <p><b>播種ID：</b>${row.seedRef}</p>
      <p><b>作業者：</b>${row.worker ?? ""}</p>
      <p><b>機械：</b>${row.machine ?? ""}</p>
      <p><b>メモ：</b><br>${row.notes ?? ""}</p>
    `
  };
}

// ===============================
// 管理作業（定植後の防除・中耕など）
// ===============================
async function loadManagementLogs() {
  const byField = new Map();

  await Promise.all(MANAGEMENT_WORK_TYPES.map(async ({ type, label, csv }) => {
    const rows = normalizeKeys(await loadCSV(csv).catch(() => []));

    rows.forEach(row => {
      const date = String(row.date || "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;

      splitFieldNames(row.field).forEach(field => {
        if (!byField.has(field)) byField.set(field, []);
        byField.get(field).push({
          type,
          label,
          date,
          workType: String(row.workType || "").trim(),
          method: String(row.method || "").trim(),
          machine: String(row.machine || "").trim(),
          worker: String(row.worker || "").trim()
        });
      });
    });
  }));

  byField.forEach(list => list.sort((a, b) => a.date.localeCompare(b.date)));
  return byField;
}

function splitFieldNames(value) {
  return String(value ?? "")
    .split(/[／/,、]/)
    .map(name => name.trim())
    .filter(Boolean);
}

// 定植日〜（初収穫日 or 本日）の期間に入る作業のみ対象にする
function getManagementEntries(row) {
  const start = String(row?.plantDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return { start: "", end: "", entries: [] };

  const harvestStart = harvestStartDateMap[String(row?.plantingRef ?? "").trim()];
  const end = harvestStart instanceof Date
    ? formatUtcDateToYmd(harvestStart)
    : todayLocalYmd();

  const entries = (managementLogsByField.get(String(row?.field || "").trim()) || [])
    .filter(entry => entry.date >= start && entry.date <= end);

  return { start, end, entries };
}

function formatUtcDateToYmd(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function buildManagementCell(row, rowIndex) {
  const { start, end, entries } = getManagementEntries(row);
  if (!start) return "-";

  const today = parseYmdToUtcDate(todayLocalYmd());
  const daysFromPlanting = diffDays(parseYmdToUtcDate(start), parseYmdToUtcDate(end));

  const badges = [];
  let otherCount = 0;

  MANAGEMENT_WORK_TYPES.forEach(config => {
    const { type, label, warnDays, alertDays, scheduleDays } = config;
    const list = entries.filter(entry => entry.type === type);

    // しきい値を持たない作業は件数だけをまとめて出す
    if (!scheduleDays && !alertDays) {
      otherCount += list.length;
      return;
    }

    // 予定日を持つ作業は未実施でもバッジを出して遅れを見せる
    const dueCount = scheduleDays && Number.isFinite(daysFromPlanting)
      ? scheduleDays.filter(day => daysFromPlanting >= day).length
      : 0;

    if (!list.length && !dueCount) return;

    const lastDate = list.length ? list[list.length - 1].date : "";
    const elapsed = lastDate ? diffDays(parseYmdToUtcDate(lastDate), today) : null;

    let stateClass = "";
    let tooltip = `${label}：全${list.length}回`;

    if (scheduleDays) {
      const shortage = dueCount - list.length;
      if (shortage >= 2) stateClass = " is-alert";
      else if (shortage === 1) stateClass = " is-warn";
      tooltip += `／定植${daysFromPlanting}日目・予定${dueCount}回（${scheduleDays.join("・")}日目）`;
    } else if (Number.isFinite(elapsed)) {
      if (elapsed >= alertDays) stateClass = " is-alert";
      else if (elapsed >= warnDays) stateClass = " is-warn";
    }

    if (lastDate) tooltip += `／最終 ${lastDate}（${elapsed}日前）`;

    // 経過日数は判断が要るときだけ添える
    const elapsedText = !list.length
      ? "未"
      : (stateClass ? `${elapsed}d` : "");

    badges.push(`<button type="button" class="management-badge${stateClass}" data-row-index="${rowIndex}" data-work-type="${type}" title="${tooltip}">
      ${label}<span class="management-badge__count">${list.length}</span>${elapsedText ? `<span class="management-badge__elapsed">${elapsedText}</span>` : ""}
    </button>`);
  });

  if (otherCount) {
    badges.push(`<button type="button" class="management-badge is-muted" data-row-index="${rowIndex}" data-work-type="__all" title="施肥・除草・かん水を含む全作業履歴">
      他<span class="management-badge__count">${otherCount}</span>
    </button>`);
  }

  return badges.join("") || "-";
}

// 薬剤・肥料名は圃場別JSONにしか無いため、モーダルを開いたときだけ取得する
async function loadFieldMaterialNames(type, field) {
  const cacheKey = `${type}::${field}`;
  if (fieldLogCache.has(cacheKey)) return fieldLogCache.get(cacheKey);

  const names = new Map();

  try {
    const data = await loadJSON(`/logs/${type}/${encodeURIComponent(field)}.json`);
    Object.values(data?.years || {}).forEach(year => {
      (year?.entries || []).forEach(entry => {
        const date = String(entry?.date || "").slice(0, 10);
        if (!date) return;
        const list = Array.isArray(entry?.distributed) ? entry.distributed : [];
        const text = [...new Set(list.map(item => String(item?.name || "").trim()).filter(Boolean))].join("、");
        if (text) names.set(date, text);
      });
    });
  } catch {
    // 圃場別JSONが無い場合は名称なしで表示する
  }

  fieldLogCache.set(cacheKey, names);
  return names;
}

async function showManagementModal(row, type) {
  const { start, end, entries } = getManagementEntries(row);
  const isAll = type === "__all";
  const target = MANAGEMENT_WORK_TYPES.find(item => item.type === type);

  const list = (isAll ? entries : entries.filter(entry => entry.type === type))
    .slice()
    .reverse();

  const materialTypes = [...new Set(list.map(entry => entry.type))]
    .filter(entryType => entryType === "pesticide" || entryType === "fertilizer");

  const materialMaps = new Map(await Promise.all(
    materialTypes.map(async entryType => [entryType, await loadFieldMaterialNames(entryType, row.field)])
  ));

  const itemsHtml = list.map(entry => {
    const material = materialMaps.get(entry.type)?.get(entry.date) || "";
    const detail = [entry.method, entry.machine, entry.worker].filter(Boolean).join(" ／ ");

    return `
      <li class="work-history__item">
        <div class="work-history__head">
          <span class="work-history__date">${entry.date}</span>
          <span class="work-history__label">${escapeHtml(entry.workType || entry.label)}</span>
        </div>
        ${material ? `<div class="work-history__material">${escapeHtml(material)}</div>` : ""}
        ${detail ? `<div class="work-history__detail">${escapeHtml(detail)}</div>` : ""}
      </li>
    `;
  }).join("");

  const workLogsUrl = `/fields/work-logs.html?field=${encodeURIComponent(row.field)}&start=${start}&end=${end}${isAll ? "" : `&type=${type}`}&return=${encodeURIComponent(location.pathname + location.search)}`;

  showInfoModal(
    `${isAll ? "作業履歴" : `${target.label}履歴`}：${row.field} / ${row.variety}`,
    `
      <p class="work-history__period">${start} 〜 ${end}（${list.length}件）</p>
      <ul class="work-history">${itemsHtml || "<li class='work-history__item'>記録がありません。</li>"}</ul>
      <p style="margin-top:12px;"><a class="secondary-btn" href="${workLogsUrl}">作業ログページで開く</a></p>
    `
  );
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderTable(rows) {

  const tableArea = document.getElementById("table-area");
  const sortedRows = sortRowsByDate(rows, "plantDate", plantDateSortOrder);

  let html = `
    <table>
      <thead>
        <tr>
          <th id="th-plant-date">${buildPlantDateHeaderLabel()}</th>
          <th>圃場</th>
          <th>品種</th>
          <th>面積(反)</th>
          <th>播種日</th>
          <th>育苗日数</th>
          <th>定植後経過日数</th>
          <th class="management-cell">管理作業</th>
        </tr>
      </thead>
      <tbody>
  `;

  let totalQuantity = 0;
  let totalAreaTan = 0;

  sortedRows.forEach((r, rowIndex) => {

    const spacing = {
      row: Number(r.spacingRow || 0),
      bed: Number(r.spacingBed || 0)
    };

    const areaM2 = calcAreaM2(r.quantity, spacing.row, spacing.bed);
    const areaTan = calcAreaTan(areaM2);

    totalQuantity += Number(r.quantity || 0);
    totalAreaTan += areaTan;

    const ref = r.plantingRef ?? "";

    html += `<tr>
      <td class="plant-date-cell" data-id="${ref}">${r.plantDate ?? ""}</td>
      <td><a href="/fields/index.html?field=${encodeURIComponent(r.field)}">${r.field}</a></td>
      <td><a href="/varieties/index.html?variety=${encodeURIComponent(r.variety)}">${r.variety}</a></td>
      <td>${areaTan.toFixed(2)}</td>
      <td>${getSeedDates(r.seedRef)}</td>
      <td>${getNurseryDays(r.seedRef, r.plantDate)}</td>
      <td>${getPostPlantingDays(r.plantDate, ref)}</td>
      <td class="management-cell">${buildManagementCell(r, rowIndex)}</td>
    </tr>`;
  });

  html += `
      </tbody>
    </table>
  `;

  document.getElementById("countArea").textContent = `${rows.length} 件`;
  document.getElementById("summaryArea").innerHTML =
    `株数合計：${totalQuantity.toLocaleString()} 株　
     面積合計：${totalAreaTan.toFixed(2)} 反`;

  window.dispatchEvent(new CustomEvent("list:summary-updated"));

  tableArea.innerHTML = html;

  const dateHeader = document.getElementById("th-plant-date");
  if (dateHeader) {
    dateHeader.style.cursor = "pointer";
    dateHeader.title = "クリックで昇順/降順を切り替え";
    dateHeader.addEventListener("click", () => {
      plantDateSortOrder = plantDateSortOrder === "asc" ? "desc" : "asc";
      renderTable(rows);
    });
  }

  document.querySelectorAll(".management-badge").forEach(badge => {
    badge.addEventListener("click", () => {
      const target = sortedRows[Number(badge.dataset.rowIndex)];
      if (target) showManagementModal(target, badge.dataset.workType);
    });
  });

  document.querySelectorAll(".plant-date-cell").forEach(cell => {
    cell.addEventListener("click", () => {
      const ref = cell.dataset.id;
      const data = getPlantDetail(ref);

      const discardActionHtml = canDiscard && ref
        ? `<div style="display:flex; flex-wrap:wrap; gap:8px; margin-top:12px;"><button class="secondary-btn" id="planting-modal-discard-btn" type="button">破棄ページへ</button><a class="secondary-btn" href="/admin/edit-csv/index.html?type=planting&amp;file=all.csv&amp;search=${encodeURIComponent(ref)}">CSVを編集</a></div>`
        : "";

      showInfoModal(data.title, `${data.html}${discardActionHtml}`);

      if (canDiscard && ref) {
        const discardBtn = document.getElementById("planting-modal-discard-btn");
        if (discardBtn) {
          discardBtn.addEventListener("click", () => {
            location.href = `/planting/discard-planting.html?ref=${encodeURIComponent(ref)}`;
          });
        }
      }
    });
  });
}

function buildPlantDateHeaderLabel() {
  if (plantDateSortOrder === "asc") return "定植日 ▲";
  if (plantDateSortOrder === "desc") return "定植日 ▼";
  return "定植日";
}

function sortRowsByDate(rows, key, order) {
  const list = Array.isArray(rows) ? rows.slice() : [];
  if (!order) return list;

  const factor = order === "asc" ? 1 : -1;
  return list.sort((a, b) => {
    const av = dateToSortableNumber(a?.[key]);
    const bv = dateToSortableNumber(b?.[key]);
    return (av - bv) * factor;
  });
}

function dateToSortableNumber(value) {
  const text = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return -1;
  return Number(text.replace(/-/g, ""));
}
