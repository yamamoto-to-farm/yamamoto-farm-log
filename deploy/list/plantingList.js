// ===============================
// plantingList.js（定植ベース一覧）
// ===============================

import { loadCSV, normalizeKeys } from "/common/csv.js";
import { loadJSON } from "/common/json.js";
import { calcAreaM2, calcAreaTan } from "/fields/analysis-utils.js";

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
    return `${days}日（収穫開始まで）`;
  }

  const now = new Date();
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const elapsed = diffDays(plant, today);
  if (!Number.isFinite(elapsed)) return "-";
  return `${elapsed}日（経過）`;
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

function renderTable(rows) {

  const tableArea = document.getElementById("table-area");
  const sortedRows = sortRowsByDate(rows, "plantDate", plantDateSortOrder);

  let html = `
    <table>
      <thead>
        <tr>
          <th id="th-plant-date">${buildPlantDateHeaderLabel()}</th>
          <th>育苗日数</th>
          <th>定植後経過日数</th>
          <th>圃場</th>
          <th>品種</th>
          <th>面積(反)</th>
          <th>播種日</th>
        </tr>
      </thead>
      <tbody>
  `;

  let totalQuantity = 0;
  let totalAreaTan = 0;

  sortedRows.forEach(r => {

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
      <td>${getNurseryDays(r.seedRef, r.plantDate)}</td>
      <td>${getPostPlantingDays(r.plantDate, ref)}</td>
      <td><a href="/fields/index.html?field=${encodeURIComponent(r.field)}">${r.field}</a></td>
      <td><a href="/varieties/index.html?variety=${encodeURIComponent(r.variety)}">${r.variety}</a></td>
      <td>${areaTan.toFixed(2)}</td>
      <td>${getSeedDates(r.seedRef)}</td>
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

  document.querySelectorAll(".plant-date-cell").forEach(cell => {
    cell.addEventListener("click", () => {
      const ref = cell.dataset.id;
      const data = getPlantDetail(ref);

      const discardActionHtml = canDiscard && ref
        ? `<div style="margin-top:12px;"><button class="secondary-btn" id="planting-modal-discard-btn" type="button">破棄ページへ</button></div>`
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
