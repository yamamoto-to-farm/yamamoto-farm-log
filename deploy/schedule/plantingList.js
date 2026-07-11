// ===============================
// plantingList.js（定植ベース一覧）
// ===============================

import { loadCSV, normalizeKeys } from "/common/csv.js";
import { loadJSON } from "/common/json.js";
import { calcAreaM2, calcAreaTan } from "/fields/analysis-utils.js";
import { saveLog } from "/common/save/index.js";

import {
  openFieldModal,
  openVarietyModal,
  setFilterData
} from "/common/filter.js";

import { showInfoModal } from "/common/showInfoModal.js";

let plantingRows = [];
let seedRows = [];
let fieldData = [];
let varietyData = [];
let fieldDetailData = {};
let canDiscard = false;
let seedPlanRows = [];
let seedPlanYearLoaded = null;
const planningAssignmentsByYear = new Map(); // year -> Map(fieldName -> [{...}])
const loadedPlanningAssignmentYears = new Set();
const areaExpandState = new Map(); // areaName -> boolean
const DEFAULT_BED_SPACING_CM = 60;
const DEFAULT_PLANT_SPACING_CM = 33;
const ACTUAL_WINDOW_MONTHS = 1;
const PLANTING_VIEW_MODE_FIELD = "field";
const PLANTING_VIEW_MODE_DATE = "date";

let filterData = {};
let initialized = false;
let plantingViewMode = PLANTING_VIEW_MODE_FIELD;
let plantingFilterButtonsBound = false;

/* ============================================================
   外部から呼ばれるエントリポイント
============================================================ */
export async function renderPlantingList() {

  // ★ planting モード以外では何もしない（エラー防止）
  const mode = new URLSearchParams(location.search).get("mode");
  if (mode !== "planting") return;

  if (!initialized) {
    await initPlantingListPage();
    initialized = true;
  }

  if (!hasPlanningYearSelection()) {
    seedPlanRows = [];
    seedPlanYearLoaded = null;
    renderYearSelectionRequiredState();
    return;
  }

  const selectedYear = getSelectedPlanningYear();
  if (selectedYear !== seedPlanYearLoaded) {
    seedPlanRows = await loadSeedPlanRows(selectedYear);
    seedPlanYearLoaded = selectedYear;
  }

  await loadPlantingPlanFromCSV(selectedYear, { silent: true });

  const state = window.currentFilterState || {};
  const filteredPlantingRows = applyAllFilters(plantingRows, state);
  registerPlantingPrintHook();
  renderFieldCards(filteredPlantingRows, state);
}

export async function loadPlantingPlanFromCSV(year, options = {}) {
  const selectedYear = String(year || getSelectedPlanningYear()).trim();
  if (!selectedYear) return false;

  const force = !!options.force;
  const silent = !!options.silent;

  if (!force && loadedPlanningAssignmentYears.has(selectedYear)) {
    return true;
  }

  try {
    const rows = normalizeKeys(await loadCSV(`/logs/schedule/planting/${selectedYear}.csv`));
    const byField = new Map();

    rows.forEach(row => {
      const fieldName = String(row.field || "").trim();
      if (!fieldName) return;

      const assignedTrayCount = Math.max(0, Math.floor(Number(row.assignedTrayCount || row.trayCount || 0)));
      const trayCount = Math.max(0, Math.floor(Number(row.trayCount || assignedTrayCount || 0)));

      const item = {
        id: String(row.id || "").trim(),
        year: selectedYear,
        variety: String(row.variety || "").trim(),
        sowDate: String(row.sowDate || "").trim(),
        planPlantDate: String(row.planPlantDate || "").trim(),
        trayType: String(row.trayType || "").trim(),
        trayCount,
        assignedTrayCount,
        plants: Number(row.plants || 0) || (trayCount * parseTrayCells(row.trayType)),
        source: String(row.source || "").trim(),
        memo: String(row.memo || "").trim()
      };

      if (!byField.has(fieldName)) byField.set(fieldName, []);
      byField.get(fieldName).push(item);
    });

    planningAssignmentsByYear.set(selectedYear, byField);
    loadedPlanningAssignmentYears.add(selectedYear);
    return true;
  } catch (e) {
    planningAssignmentsByYear.set(selectedYear, new Map());
    loadedPlanningAssignmentYears.add(selectedYear);
    if (!silent) {
      alert(`${selectedYear}年の定植計画CSVが見つかりませんでした。`);
    }
    return false;
  }
}

export async function savePlantingPlan() {
  const year = String(getSelectedPlanningYear() || "").trim();
  if (!year || !hasPlanningYearSelection()) {
    alert("年度を選択してください。");
    return;
  }

  const planningAssignments = getPlanningAssignmentsForYear(year);
  const rows = [];

  planningAssignments.forEach((items, fieldName) => {
    const keyField = String(fieldName || "").trim();
    if (!keyField) return;

    items.forEach(item => {
      const assignedTrayCount = Math.max(0, Math.floor(getAssignedTrayCount(item)));
      if (assignedTrayCount <= 0) return;

      rows.push({
        id: String(item.id || "").trim(),
        field: keyField,
        variety: String(item.variety || "").trim(),
        sowDate: String(item.sowDate || "").trim(),
        planPlantDate: String(item.planPlantDate || "").trim(),
        trayType: String(item.trayType || "").trim(),
        trayCount: Math.max(0, Math.floor(Number(item.trayCount || 0))),
        assignedTrayCount,
        plants: Math.max(0, Math.floor(getAssignedPlants(item))),
        source: String(item.source || "").trim(),
        memo: String(item.memo || "").trim()
      });
    });
  });

  rows.sort((a, b) => {
    const dCmp = String(a.planPlantDate || "").localeCompare(String(b.planPlantDate || ""));
    if (dCmp !== 0) return dCmp;
    const fCmp = String(a.field || "").localeCompare(String(b.field || ""), "ja");
    if (fCmp !== 0) return fCmp;
    return String(a.variety || "").localeCompare(String(b.variety || ""), "ja");
  });

  const csv = convertPlantingAssignmentsToCsv(rows);

  await saveLog(
    "schedule/planting",
    `${year}`,
    {},
    "",
    csv,
    `${year}.csv`
  );

  loadedPlanningAssignmentYears.add(year);
}

function convertPlantingAssignmentsToCsv(rows) {
  const header = [
    "id",
    "field",
    "variety",
    "sowDate",
    "planPlantDate",
    "trayType",
    "trayCount",
    "assignedTrayCount",
    "plants",
    "source",
    "memo"
  ];

  const lines = [header.join(",")];
  rows.forEach(row => {
    const cols = [
      row.id || "",
      row.field || "",
      row.variety || "",
      row.sowDate || "",
      row.planPlantDate || "",
      row.trayType || "",
      row.trayCount || 0,
      row.assignedTrayCount || 0,
      row.plants || 0,
      (row.source || "").replace(/,/g, "、"),
      (row.memo || "").replace(/,/g, "、")
    ];
    lines.push(cols.map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));
  });

  return `${lines.join("\n")}\n`;
}

/* ============================================================
   初期化
============================================================ */
async function initPlantingListPage() {

  // ★ planting モード以外では初期化しない
  const mode = new URLSearchParams(location.search).get("mode");
  if (mode !== "planting") return;

  if (window.currentRole === "admin") canDiscard = true;

  plantingRows = normalizeKeys(await loadCSV("/logs/planting/all.csv"));
  seedRows = normalizeKeys(await loadCSV("/logs/seed/all.csv"));

  if (hasPlanningYearSelection()) {
    seedPlanYearLoaded = getSelectedPlanningYear();
    seedPlanRows = await loadSeedPlanRows(seedPlanYearLoaded);
  } else {
    seedPlanYearLoaded = null;
    seedPlanRows = [];
  }

  fieldData = await loadJSON("/data/fields.json");
  varietyData = await loadJSON("/data/varieties.json");
  fieldDetailData = await loadJSON("/data/field-detail.json");

  /* ▼ 年 → 月マップ生成 */
  const ymMap = {};
  plantingRows.forEach(r => {
    if (!r.plantDate) return;
    const y = r.plantDate.slice(0, 4);
    const m = r.plantDate.slice(5, 7);
    if (!ymMap[y]) ymMap[y] = [];
    if (!ymMap[y].includes(m)) ymMap[y].push(m);
  });
  Object.keys(ymMap).forEach(y => ymMap[y].sort());

  /* ▼ 圃場 area → name */
  const areaMap = {};
  const areaOrder = [];
  fieldData.forEach(f => {
    if (!areaMap[f.area]) {
      areaMap[f.area] = [];
      areaOrder.push(f.area);
    }
    areaMap[f.area].push(f.name);
  });

  /* ▼ 品種 type → name */
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

  // ▼ フィルタ UI 初期化
  setFilterData(filterData);

  // ▼ list.js がモード切替時に再適用できるよう保存
  window.plantingFilterData = filterData;

  if (!plantingFilterButtonsBound) {
    document.addEventListener("click", (event) => {
      const target = event.target instanceof HTMLElement
        ? event.target.closest(".planting-view-filter-btn")
        : null;
      if (!target) return;
      const type = String(target.dataset.type || "").trim();
      if (type === "field") {
        openFieldModal();
      } else if (type === "variety") {
        openVarietyModal();
      }
    });
    plantingFilterButtonsBound = true;
  }

  window.addEventListener("filter:apply", (e) => {
    window.currentFilterState = e.detail;
    if (!hasPlanningYearSelection()) {
      renderYearSelectionRequiredState();
      return;
    }
    renderFieldCards(applyAllFilters(plantingRows, e.detail), e.detail);
  });

  window.addEventListener("filter:reset", () => {
    window.currentFilterState = {};
    if (!hasPlanningYearSelection()) {
      renderYearSelectionRequiredState();
      return;
    }
    renderFieldCards(plantingRows, {});
  });
}

/* ============================================================
   フィルタ適用
============================================================ */
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

/* ============================================================
   播種日（複数対応）
============================================================ */
function getSeedDates(seedRef) {
  if (!seedRef) return "";
  const clean = s => (s ?? "").replace(/\s+/g, "").trim();
  const refs = seedRef.split(",").map(s => clean(s));

  const dates = refs.map(ref => {
    const row = seedRows.find(s => clean(s.seedRef) === ref);
    return row?.seedDate ?? "";
  });

  return dates.filter(d => d).join("<br>");
}

/* ============================================================
   モーダル用データ
============================================================ */
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

/* ============================================================
   テーブル描画
============================================================ */
function renderFieldCards(rows, state = {}) {

  const tableArea = document.getElementById("table-area");
  const selectedYear = Number(getSelectedPlanningYear()) || new Date().getFullYear();
  const planningAssignments = getCurrentPlanningAssignments();

  const targetFields = getTargetFields(rows, state);
  if (!targetFields.length) {
    tableArea.innerHTML = `<div class="card"><p>対象の圃場がありません。</p></div>`;
    const summary = document.getElementById("summaryArea");
    if (summary) {
      summary.textContent = "表示圃場：0件";
    }
    return;
  }

  const displayMode = plantingViewMode === PLANTING_VIEW_MODE_DATE
    ? PLANTING_VIEW_MODE_DATE
    : PLANTING_VIEW_MODE_FIELD;

  let html = "";
  let totalAssignedPlants = 0;
  let totalAssignedTrays = 0;

  const grouped = new Map();
  targetFields.forEach(field => {
    const areaName = String(field.area || "その他").trim() || "その他";
    if (!grouped.has(areaName)) grouped.set(areaName, []);
    grouped.get(areaName).push(field);
  });

  const planningStats = targetFields.reduce((acc, field) => {
    const fieldName = String(field.name || "").trim();
    const assignments = planningAssignments.get(fieldName) || [];
    const fieldPlants = assignments.reduce((sum, item) => sum + getAssignedPlants(item), 0);
    const fieldTrays = assignments.reduce((sum, item) => sum + getAssignedTrayCount(item), 0);
    const cap = calcBaseRequirement(fieldName, DEFAULT_BED_SPACING_CM, DEFAULT_PLANT_SPACING_CM);
    const sizeA = getFieldSizeA(fieldName);

    acc.assignedPlants += fieldPlants;
    acc.assignedTrays += fieldTrays;
    acc.capacityTrays128 += cap.valid ? Number(cap.requiredTray128 || 0) : 0;
    acc.capacityTrays200 += cap.valid ? Number(cap.requiredTray200 || 0) : 0;
    acc.totalAreaTan += sizeA > 0 ? (sizeA / 10) : 0;
    if (assignments.length > 0) acc.fieldsAssigned += 1;
    return acc;
  }, {
    assignedPlants: 0,
    assignedTrays: 0,
    capacityTrays128: 0,
    capacityTrays200: 0,
    totalAreaTan: 0,
    fieldsAssigned: 0
  });

  const totalAssignedAreaTan = calcAreaTan(
    calcAreaM2(planningStats.assignedPlants, DEFAULT_PLANT_SPACING_CM, DEFAULT_BED_SPACING_CM)
  );

  const seedPlanPlantsTotal = seedPlanRows.reduce((acc, row) => acc + Number(row.plants || 0), 0);
  const plantingPlanTray128 = Math.ceil(planningStats.assignedPlants / 128);
  const plantingPlanTray200 = Math.ceil(planningStats.assignedPlants / 200);
  const seedPlanTray128 = Math.ceil(seedPlanPlantsTotal / 128);
  const seedPlanTray200 = Math.ceil(seedPlanPlantsTotal / 200);

  totalAssignedPlants = planningStats.assignedPlants;
  totalAssignedTrays = planningStats.assignedTrays;

  html += `
    <section class="card planting-view-switch-card print-hide">
      <h3 class="section-title">表示モード</h3>
      <div class="planting-view-switch" role="group" aria-label="定植計画表示モード">
        <button type="button" class="secondary-btn planting-view-btn ${displayMode === PLANTING_VIEW_MODE_FIELD ? "active" : ""}" data-view-mode="${PLANTING_VIEW_MODE_FIELD}">作成ビュー（圃場ごと）</button>
        <button type="button" class="secondary-btn planting-view-btn ${displayMode === PLANTING_VIEW_MODE_DATE ? "active" : ""}" data-view-mode="${PLANTING_VIEW_MODE_DATE}">運用ビュー（定植日順）</button>
      </div>
      <p class="planting-view-filter-title">フィルタ</p>
      <div class="planting-view-filter-row" role="group" aria-label="定植絞り込み">
        <button type="button" class="secondary-btn planting-view-filter-btn" data-type="field">圃場で絞り込み</button>
        <button type="button" class="secondary-btn planting-view-filter-btn" data-type="variety">品種で絞り込み</button>
      </div>
    </section>
  `;

  html += `
    <section class="card planting-field-group planting-overview-card">
      <h3 class="section-title">定植計画サマリー</h3>
      <div class="planting-overview-grid">
        <div class="planting-overview-item">
          <div class="overview-label">圃場</div>
          <div class="overview-value">${planningStats.fieldsAssigned} / ${targetFields.length}</div>
          <div class="overview-sub">割当済み / 総圃場</div>
        </div>
        <div class="planting-overview-item">
          <div class="overview-label">面積</div>
          <div class="overview-value">${planningStats.totalAreaTan.toFixed(2)}反</div>
          <div class="overview-sub">総耕作面積</div>
        </div>
        <div class="planting-overview-item">
          <div class="overview-label">作付面積</div>
          <div class="overview-value">${totalAssignedAreaTan.toFixed(2)}反</div>
          <div class="overview-sub">計画割当ベース</div>
        </div>
        <div class="planting-overview-item">
          <div class="overview-label">定植可能枚数</div>
          <div class="overview-value">128穴 ${planningStats.capacityTrays128.toLocaleString()} / 200穴 ${planningStats.capacityTrays200.toLocaleString()}</div>
          <div class="overview-sub">圃場面積ベース</div>
        </div>
        <div class="planting-overview-item">
          <div class="overview-label">定植計画合計</div>
          <div class="overview-value">128穴 ${plantingPlanTray128.toLocaleString()} / 200穴 ${plantingPlanTray200.toLocaleString()}</div>
          <div class="overview-sub">割当株数ベース</div>
        </div>
        <div class="planting-overview-item">
          <div class="overview-label">播種計画合計</div>
          <div class="overview-value">128穴 ${seedPlanTray128.toLocaleString()} / 200穴 ${seedPlanTray200.toLocaleString()}</div>
          <div class="overview-sub">比較用</div>
        </div>
      </div>
    </section>
  `;

  if (displayMode === PLANTING_VIEW_MODE_DATE) {
    const dateRows = [];
    targetFields.forEach(field => {
      const fieldName = String(field.name || "").trim();
      const areaName = String(field.area || "その他").trim() || "その他";
      const assignments = planningAssignments.get(fieldName) || [];
      if (!assignments.length) {
        dateRows.push({
          planDate: "",
          fieldName,
          areaName,
          assignments: []
        });
        return;
      }
      assignments.forEach(item => {
        dateRows.push({
          planDate: String(item.planPlantDate || "").trim(),
          fieldName,
          areaName,
          assignments: [item]
        });
      });
    });

    dateRows.sort((a, b) => {
      const ad = String(a.planDate || "").trim();
      const bd = String(b.planDate || "").trim();
      if (!ad && bd) return 1;
      if (ad && !bd) return -1;
      const dCmp = ad.localeCompare(bd);
      if (dCmp !== 0) return dCmp;
      const fCmp = String(a.fieldName || "").localeCompare(String(b.fieldName || ""), "ja");
      if (fCmp !== 0) return fCmp;
      const av = String(a.assignments[0]?.variety || "").trim();
      const bv = String(b.assignments[0]?.variety || "").trim();
      return av.localeCompare(bv, "ja");
    });

    const groupedByDate = new Map();
    dateRows.forEach(item => {
      const key = String(item.planDate || "").trim() || "未設定";
      if (!groupedByDate.has(key)) groupedByDate.set(key, []);
      groupedByDate.get(key).push(item);
    });

    groupedByDate.forEach((items, dateKey) => {
      html += `
        <section class="card planting-area-group">
          <h4 class="section-title">${escapeHtml(dateKey)}（${items.length}件）</h4>
          <div class="planting-area-body" style="display:block">
            <table class="planting-plan-table">
              <colgroup>
                <col style="width:20%">
                <col style="width:16%">
                <col style="width:18%">
                <col style="width:21%">
                <col style="width:25%">
              </colgroup>
              <thead>
                <tr>
                  <th>圃場名</th>
                  <th>定植予定日</th>
                  <th>品種</th>
                  <th>枚数（トレイ種別）</th>
                  <th>実績</th>
                </tr>
              </thead>
              <tbody>
      `;

      items.forEach(item => {
        const fieldName = String(item.fieldName || "").trim();
        const actualSummary = buildRecentActualSummary(fieldName, selectedYear);
        const actualTrayText = actualSummary.trayLines.length
          ? actualSummary.trayLines.map(v => escapeHtml(v)).join("<br>")
          : "-";
        const assignments = item.assignments;
        const plannedPlants = assignments.reduce((acc, v) => acc + getAssignedPlants(v), 0);
        const plannedTrays = assignments.reduce((acc, v) => acc + getAssignedTrayCount(v), 0);
        const assignmentRows = buildAssignmentDisplayRows(assignments);
        const whenHtml = assignmentRows.datesHtml;
        const whatHtml = assignmentRows.varietiesHtml;
        const planTraySummary = buildPlanTraySummary(assignments);
        const planRowsHtml = planTraySummary.itemLinesHtml;
        const isUnset = assignments.length === 0 || (plannedPlants <= 0 && plannedTrays <= 0);
        const statusText = isUnset ? "未設定" : "確定";
        const statusClass = isUnset ? "is-unset" : "is-set";

        html += `
          <tr class="planting-plan-row ${isUnset ? "row-unset" : ""}" data-field="${escapeAttr(fieldName)}">
            <td>
              <strong>${escapeHtml(fieldName)}</strong><span class="field-status-badge ${statusClass}">${escapeHtml(statusText)}</span>
              <div class="field-sub">${escapeHtml(String(item.areaName || "その他"))}</div>
            </td>
            <td>
              <div class="plan-sub plan-lines">${whenHtml}</div>
            </td>
            <td>
              <div class="plan-sub plan-lines">${whatHtml}</div>
            </td>
            <td>
              <div class="plan-sub"><strong>${planTraySummary.totalTrays.toLocaleString()}枚 / ${planTraySummary.totalPlants.toLocaleString()}株</strong></div>
              <div class="plan-sub plan-lines">${planRowsHtml}</div>
              <div class="plan-sub">作付面積: ${planTraySummary.areaTan.toFixed(2)}反</div>
            </td>
            <td>
              <div class="last-planting-label">前回定植：${escapeHtml(actualSummary.latestDate || "-")}</div>
              <div class="plan-sub">${actualTrayText}</div>
              <div class="plan-sub">作付面積: ${actualSummary.areaTan.toFixed(2)}反（${escapeHtml(actualSummary.windowLabel)}）</div>
            </td>
          </tr>
        `;
      });

      html += `
              </tbody>
            </table>
          </div>
        </section>
      `;
    });
  } else {
    grouped.forEach((fields, areaName) => {
      const expanded = getAreaExpanded(areaName);
      const hasUnsetInArea = fields.some(field => {
        const fieldName = String(field.name || "").trim();
        const assignments = planningAssignments.get(fieldName) || [];
        const plannedPlants = assignments.reduce((acc, item) => acc + getAssignedPlants(item), 0);
        const plannedTrays = assignments.reduce((acc, item) => acc + getAssignedTrayCount(item), 0);
        return assignments.length === 0 || (plannedPlants <= 0 && plannedTrays <= 0);
      });

      html += `
        <section class="card planting-area-group ${hasUnsetInArea ? "area-has-unset" : ""}">
          <h4 class="section-title planting-area-title" data-area="${escapeAttr(areaName)}">${expanded ? "▼" : "▶"} ${escapeHtml(areaName)}（${fields.length}圃場）</h4>
          <div class="planting-area-body" style="display:${expanded ? "block" : "none"}">
            <table class="planting-plan-table">
              <colgroup>
                <col style="width:20%">
                <col style="width:16%">
                <col style="width:18%">
                <col style="width:21%">
                <col style="width:25%">
              </colgroup>
              <thead>
                <tr>
                  <th>圃場名</th>
                  <th>定植予定日</th>
                  <th>品種</th>
                  <th>枚数（トレイ種別）</th>
                  <th>実績</th>
                </tr>
              </thead>
              <tbody>
      `;

      fields.forEach(field => {
        const fieldName = String(field.name || "").trim();
        const actualSummary = buildRecentActualSummary(fieldName, selectedYear);
        const actualTrayText = actualSummary.trayLines.length
          ? actualSummary.trayLines.map(v => escapeHtml(v)).join("<br>")
          : "-";

        const assignments = planningAssignments.get(fieldName) || [];
        const plannedPlants = assignments.reduce((acc, item) => acc + getAssignedPlants(item), 0);
        const plannedTrays = assignments.reduce((acc, item) => acc + getAssignedTrayCount(item), 0);

        const assignmentRows = buildAssignmentDisplayRows(assignments);
        const whenHtml = assignmentRows.datesHtml;
        const whatHtml = assignmentRows.varietiesHtml;
        const planTraySummary = buildPlanTraySummary(assignments);
        const planRowsHtml = planTraySummary.itemLinesHtml;
        const isUnset = assignments.length === 0 || (plannedPlants <= 0 && plannedTrays <= 0);
        const statusText = isUnset ? "未設定" : `候補${assignments.length}件`;
        const statusClass = isUnset ? "is-unset" : "is-set";

        html += `
          <tr class="planting-plan-row ${isUnset ? "row-unset" : ""}" data-field="${escapeAttr(fieldName)}">
            <td>
              <strong>${escapeHtml(fieldName)}</strong><span class="field-status-badge ${statusClass}">${escapeHtml(statusText)}</span>
              <div class="field-sub">${escapeHtml(String(field.area || "その他"))}</div>
            </td>
            <td>
              <div class="plan-sub plan-lines">${whenHtml}</div>
            </td>
            <td>
              <div class="plan-sub plan-lines">${whatHtml}</div>
            </td>
            <td>
              <div class="plan-sub"><strong>${planTraySummary.totalTrays.toLocaleString()}枚 / ${planTraySummary.totalPlants.toLocaleString()}株</strong></div>
              <div class="plan-sub plan-lines">${planRowsHtml}</div>
              <div class="plan-sub">作付面積: ${planTraySummary.areaTan.toFixed(2)}反</div>
            </td>
            <td>
              <div class="last-planting-label">前回定植：${escapeHtml(actualSummary.latestDate || "-")}</div>
              <div class="plan-sub">${actualTrayText}</div>
              <div class="plan-sub">作付面積: ${actualSummary.areaTan.toFixed(2)}反（${escapeHtml(actualSummary.windowLabel)}）</div>
            </td>
          </tr>
        `;
      });

      html += `
              </tbody>
            </table>
          </div>
        </section>
      `;
    });
  }

  tableArea.innerHTML = html;

  document.querySelectorAll(".planting-view-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const nextMode = String(btn.dataset.viewMode || "").trim();
      if (![PLANTING_VIEW_MODE_FIELD, PLANTING_VIEW_MODE_DATE].includes(nextMode)) return;
      if (plantingViewMode === nextMode) return;
      plantingViewMode = nextMode;
      renderFieldCards(rows, state);
    });
  });

  if (displayMode === PLANTING_VIEW_MODE_FIELD) {
    document.querySelectorAll(".planting-area-title").forEach(el => {
      el.addEventListener("click", () => {
        const areaName = String(el.dataset.area || "").trim();
        if (!areaName) return;
        areaExpandState.set(areaName, !getAreaExpanded(areaName));
        renderFieldCards(rows, state);
      });
    });
  }

  document.querySelectorAll(".planting-plan-row").forEach(el => {
    el.addEventListener("click", () => {
      const fieldName = el.dataset.field || "";
      openPlantingPlanModal(fieldName);
    });
  });

  const summary = document.getElementById("summaryArea");
  if (summary) {
    summary.textContent = `表示圃場：${targetFields.length}件　計画合計：${totalAssignedPlants.toLocaleString()}株 / ${totalAssignedTrays.toLocaleString()}枚`;
  }
}

function registerPlantingPrintHook() {
  window.__beforePrintPrepare = async () => {
    const mode = new URLSearchParams(location.search).get("mode");
    if (mode !== "planting") return null;

    const prevMode = plantingViewMode;
    if (prevMode === PLANTING_VIEW_MODE_DATE) {
      return null;
    }

    plantingViewMode = PLANTING_VIEW_MODE_DATE;
    const state = window.currentFilterState || {};
    const rows = applyAllFilters(plantingRows, state);
    renderFieldCards(rows, state);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    return async () => {
      plantingViewMode = prevMode;
      const restoreState = window.currentFilterState || {};
      const restoreRows = applyAllFilters(plantingRows, restoreState);
      renderFieldCards(restoreRows, restoreState);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    };
  };
}

function getAreaExpanded(areaName) {
  if (!areaExpandState.has(areaName)) {
    areaExpandState.set(areaName, false);
  }
  return !!areaExpandState.get(areaName);
}

function buildAssignmentDisplayRows(assignments) {
  if (!assignments.length) {
    return {
      datesHtml: "未設定",
      varietiesHtml: "未設定",
      uniqueVarietyCount: 0
    };
  }

  const dateRows = assignments
    .map(item => String(item.planPlantDate || "").trim() || "未設定")
    .map(v => `<div class="plan-line">${escapeHtml(v)}</div>`)
    .join("");

  const varietyRows = assignments
    .map(item => String(item.variety || "").trim() || "(品種未設定)")
    .map(v => `<div class="plan-line">${escapeHtml(v)}</div>`)
    .join("");

  const uniqueVarietyCount = new Set(
    assignments.map(item => String(item.variety || "").trim() || "(品種未設定)")
  ).size;

  return {
    datesHtml: dateRows,
    varietiesHtml: varietyRows,
    uniqueVarietyCount
  };
}

function getTargetFields(rows, state = {}) {
  const selectedFieldNames = Array.isArray(state?.fields) ? state.fields : [];
  const rowFieldSet = new Set(rows.map(r => String(r.field || "").trim()).filter(Boolean));

  const all = Array.isArray(fieldData) ? fieldData : [];
  let result = all;

  if (selectedFieldNames.length > 0) {
    const selected = new Set(selectedFieldNames.map(v => String(v || "").trim()).filter(Boolean));
    result = result.filter(f => selected.has(String(f.name || "").trim()));
    return result;
  }

  if (Array.isArray(state?.yearMonths) && state.yearMonths.length > 0) {
    result = result.filter(f => rowFieldSet.has(String(f.name || "").trim()));
    return result;
  }

  if (Array.isArray(state?.varieties) && state.varieties.length > 0) {
    result = result.filter(f => rowFieldSet.has(String(f.name || "").trim()));
  }

  return result;
}

function getSelectedPlanningYear() {
  const label = document.getElementById("selectedYearLabel")?.textContent || "";
  const m = String(label).match(/(\d{4})/);
  if (m) return m[1];
  return String(new Date().getFullYear());
}

function hasPlanningYearSelection() {
  const label = document.getElementById("selectedYearLabel")?.textContent || "";
  return /(\d{4})/.test(String(label));
}

function renderYearSelectionRequiredState() {
  const tableArea = document.getElementById("table-area");
  if (tableArea) {
    tableArea.innerHTML = `
      <section class="card">
        <h3 class="section-title">定植計画</h3>
        <p>年度を選択すると表示・編集できます。</p>
      </section>
    `;
  }

  const summary = document.getElementById("summaryArea");
  if (summary) {
    summary.textContent = "年度未選択";
  }
}

function getPlanningAssignmentsForYear(year) {
  const key = String(year || getSelectedPlanningYear());
  if (!planningAssignmentsByYear.has(key)) {
    planningAssignmentsByYear.set(key, new Map());
  }
  return planningAssignmentsByYear.get(key);
}

function getCurrentPlanningAssignments() {
  return getPlanningAssignmentsForYear(getSelectedPlanningYear());
}

async function loadSeedPlanRows(year) {
  try {
    const rows = normalizeKeys(await loadCSV(`/logs/schedule/seed/${year}.csv`));
    return rows.map((row, index) => {
      const trayCount = Number(row.trayCount || 0);
      const cells = parseTrayCells(row.trayType);
      return {
        id: `${year}-${index}`,
        year,
        variety: String(row.variety || "").trim(),
        sowDate: String(row.sowDate || "").trim(),
        planPlantDate: String(row.planPlantDate || "").trim(),
        trayType: String(row.trayType || "").trim(),
        trayCount,
        plants: trayCount * cells,
        source: String(row.source || "").trim(),
        memo: String(row.memo || "").trim()
      };
    });
  } catch {
    return [];
  }
}

function parseTrayCells(trayType) {
  const m = String(trayType || "").match(/(\d{2,3})/);
  if (!m) return 128;
  const v = Number(m[1]);
  return Number.isFinite(v) && v > 0 ? v : 128;
}

function parseFlexibleNumber(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  const text = String(value ?? "").replace(/,/g, "").trim();
  const m = text.match(/\d+(?:\.\d+)?/);
  if (!m) return 0;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : 0;
}

function getFieldSizeA(fieldName) {
  const raw = fieldDetailData?.[fieldName]?.size;
  const sizeA = parseFlexibleNumber(raw);
  return sizeA > 0 ? sizeA : 0;
}

function calcBaseRequirement(fieldName, bedCm, plantCm) {
  const areaA = getFieldSizeA(fieldName);
  if (areaA <= 0 || bedCm <= 0 || plantCm <= 0) {
    return {
      areaA,
      requiredPlants: 0,
      requiredTray128: 0,
      requiredTray200: 0,
      valid: false
    };
  }

  const areaM2 = areaA * 100;
  const onePlantAreaM2 = (bedCm / 100) * (plantCm / 100);
  const requiredPlants = Math.ceil(areaM2 / onePlantAreaM2);

  return {
    areaA,
    requiredPlants,
    requiredTray128: Math.ceil(requiredPlants / 128),
    requiredTray200: Math.ceil(requiredPlants / 200),
    valid: true
  };
}

function buildRecentActualSummary(fieldName, selectedYear) {
  const target = String(fieldName || "").trim();

  const allRows = plantingRows.filter(row => {
    if (String(row.field || "").trim() !== target) return false;
    const d = String(row.plantDate || "").trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(d);
  });

  if (allRows.length === 0) {
    return {
      latestDate: "",
      areaTan: 0,
      trayLines: [],
      windowLabel: "実績なし"
    };
  }

  const yearPrefix = `${Number(selectedYear) || new Date().getFullYear()}-`;
  const yearRows = allRows.filter(row => String(row.plantDate || "").startsWith(yearPrefix));
  const latestBaseRows = yearRows.length > 0 ? yearRows : allRows;
  const latestDate = latestBaseRows.reduce((maxDate, row) => {
    const d = String(row.plantDate || "").trim();
    if (!maxDate) return d;
    return d > maxDate ? d : maxDate;
  }, "");

  const windowStart = shiftMonth(latestDate, -ACTUAL_WINDOW_MONTHS);
  const windowEnd = shiftMonth(latestDate, ACTUAL_WINDOW_MONTHS);

  const recentRows = allRows.filter(row => {
    const d = String(row.plantDate || "").trim();
    return d >= windowStart && d <= windowEnd;
  });

  const areaTan = recentRows.reduce((acc, row) => {
    const spacing = {
      row: Number(row.spacingRow || 0),
      bed: Number(row.spacingBed || 0)
    };
    const areaM2 = calcAreaM2(Number(row.quantity || 0), spacing.row, spacing.bed);
    return acc + calcAreaTan(areaM2);
  }, 0);

  const byTray = new Map();
  recentRows.forEach(row => {
    const variety = String(row.variety || "").trim() || "(品種未設定)";
    const trayType = String(row.trayType || "").trim() || "tray未設定";
    const key = `${variety}\t${trayType}`;
    const quantityValue = Number(row.quantity || 0);
    let trayCount = Number(row.trayCount || 0);
    if (!(trayCount > 0) && quantityValue > 0) {
      trayCount = Math.ceil(quantityValue / parseTrayCells(row.trayType));
    }

    const areaM2 = calcAreaM2(
      quantityValue,
      Number(row.spacingRow || 0),
      Number(row.spacingBed || 0)
    );
    const areaTanValue = calcAreaTan(areaM2);

    const prev = byTray.get(key) || { variety, trayType, quantity: 0, trays: 0, areaTan: 0 };
    prev.quantity += quantityValue;
    prev.trays += trayCount;
    prev.areaTan += areaTanValue;
    byTray.set(key, prev);
  });

  const trayLines = Array.from(byTray.values())
    .sort((a, b) => b.trays - a.trays)
    .slice(0, 3)
    .map(v => `${v.variety}: ${Math.round(v.trays).toLocaleString()}枚（${v.trayType}） / ${Math.round(v.quantity).toLocaleString()}株 / ${v.areaTan.toFixed(2)}反`);

  const restCount = byTray.size - trayLines.length;
  if (restCount > 0) {
    trayLines.push(`ほか${restCount}件`);
  }

  return {
    latestDate,
    areaTan,
    trayLines,
    windowLabel: `${windowStart}〜${windowEnd}`
  };
}

function shiftMonth(ymd, diffMonth) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd || ""))) return "";
  const d = new Date(`${ymd}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  d.setMonth(d.getMonth() + diffMonth);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function buildPlanTraySummary(assignments) {
  if (!assignments.length) {
    return {
      itemLinesHtml: "未設定",
      totalTrays: 0,
      totalPlants: 0,
      areaTan: 0
    };
  }

  const itemLinesHtml = assignments
    .map(item => {
      const trayCount = getAssignedTrayCount(item);
      const trayType = String(item.trayType || "").trim() || "tray未設定";
      const plants = getAssignedPlants(item);
      const variety = String(item.variety || "").trim() || "(品種未設定)";
      return `<div class="plan-line">${escapeHtml(variety)}: ${Math.round(trayCount).toLocaleString()}枚（${escapeHtml(trayType)}） / ${Math.round(plants).toLocaleString()}株</div>`;
    })
    .join("");

  const byTrayType = new Map();

  assignments.forEach(item => {
    const trayType = String(item.trayType || "").trim() || "tray未設定";
    const trayCount = getAssignedTrayCount(item);
    const plants = getAssignedPlants(item);
    const prev = byTrayType.get(trayType) || { trayType, trayCount: 0, plants: 0 };
    prev.trayCount += trayCount;
    prev.plants += plants;
    byTrayType.set(trayType, prev);
  });

  const lines = Array.from(byTrayType.values())
    .sort((a, b) => b.trayCount - a.trayCount)
    .map(v => `${Math.round(v.trayCount).toLocaleString()}枚（${v.trayType}）`);

  const totalTrays = Array.from(byTrayType.values()).reduce((acc, v) => acc + v.trayCount, 0);
  const totalPlants = Array.from(byTrayType.values()).reduce((acc, v) => acc + v.plants, 0);
  const areaM2 = calcAreaM2(totalPlants, DEFAULT_PLANT_SPACING_CM, DEFAULT_BED_SPACING_CM);

  return {
    itemLinesHtml,
    totalTrays,
    totalPlants,
    areaTan: calcAreaTan(areaM2)
  };
}

function getAssignedTrayCount(item) {
  const assigned = Number(item?.assignedTrayCount);
  if (Number.isFinite(assigned) && assigned >= 0) return assigned;
  const fallback = Number(item?.trayCount || 0);
  return Number.isFinite(fallback) && fallback >= 0 ? fallback : 0;
}

function getAssignedPlants(item) {
  const trays = getAssignedTrayCount(item);
  return Math.round(trays * parseTrayCells(item?.trayType));
}

function getTotalAssignedTraysForSeed(seedId, options = {}) {
  const target = String(seedId || "").trim();
  if (!target) return 0;

  const excludeField = String(options.excludeField || "").trim();
  const excludeId = String(options.excludeId || "").trim();
  let total = 0;
  const planningAssignments = getCurrentPlanningAssignments();

  planningAssignments.forEach((items, fieldName) => {
    const fieldKey = String(fieldName || "").trim();
    items.forEach(item => {
      const id = String(item.id || "").trim();
      if (id !== target) return;
      if (excludeField && excludeId && fieldKey === excludeField && id === excludeId) return;
      total += getAssignedTrayCount(item);
    });
  });

  return total;
}

function getSeedPlanById(seedId) {
  const target = String(seedId || "").trim();
  if (!target) return null;
  return seedPlanRows.find(v => String(v.id || "").trim() === target) || null;
}

function getRemainingTrays(seedId, totalTrays, options = {}) {
  const remain = Number(totalTrays || 0) - getTotalAssignedTraysForSeed(seedId, options);
  return remain > 0 ? remain : 0;
}

function upsertAssignment(fieldName, picked, assignedTrayCount) {
  const planningAssignments = getCurrentPlanningAssignments();
  const next = [...(planningAssignments.get(fieldName) || [])];
  const idx = next.findIndex(v => String(v.id || "") === String(picked.id || ""));

  const payload = {
    ...picked,
    assignedTrayCount: Math.max(0, Math.floor(Number(assignedTrayCount || 0)))
  };

  if (idx >= 0) {
    next[idx] = { ...next[idx], ...payload };
  } else {
    next.push(payload);
  }

  planningAssignments.set(fieldName, next);
}

function removeAssignment(fieldName, seedId) {
  const planningAssignments = getCurrentPlanningAssignments();
  const next = [...(planningAssignments.get(fieldName) || [])].filter(v => String(v.id || "") !== String(seedId || ""));
  planningAssignments.set(fieldName, next);
}

function getFieldCapacityPlants(fieldName, bedCm, plantCm) {
  const base = calcBaseRequirement(fieldName, bedCm, plantCm);
  if (!base.valid) return 0;
  return Number(base.requiredPlants || 0);
}

function getAssignedPlantsTotal(assignments, options = {}) {
  const excludeId = String(options.excludeId || "").trim();
  return assignments.reduce((acc, item) => {
    const id = String(item.id || "").trim();
    if (excludeId && id === excludeId) return acc;
    return acc + getAssignedPlants(item);
  }, 0);
}

function openPlantingPlanModal(fieldName) {
  const planningAssignments = getCurrentPlanningAssignments();
  const assignments = planningAssignments.get(fieldName) || [];
  const plannedPlants = assignments.reduce((acc, item) => acc + getAssignedPlants(item), 0);
  const plannedTrays = assignments.reduce((acc, item) => acc + getAssignedTrayCount(item), 0);
  const baseRequirement = calcBaseRequirement(fieldName, DEFAULT_BED_SPACING_CM, DEFAULT_PLANT_SPACING_CM);
  const areaText = baseRequirement.areaA > 0 ? `${(baseRequirement.areaA / 10).toFixed(2)}反` : "未設定";
  const requiredTray128Text = baseRequirement.valid ? baseRequirement.requiredTray128.toLocaleString() : "-";
  const requiredTray200Text = baseRequirement.valid ? baseRequirement.requiredTray200.toLocaleString() : "-";
  const defaultAssignableByField = baseRequirement.valid ? Math.max(0, Math.floor(baseRequirement.requiredTray128)) : 0;

  const seedMonthOptions = Array.from(
    new Set(
      seedPlanRows
        .map(item => String(item.planPlantDate || "").trim().slice(0, 7))
        .filter(v => /^\d{4}-\d{2}$/.test(v))
    )
  ).sort((a, b) => a.localeCompare(b));

  const assignmentRows = assignments.length
    ? assignments.map(item => `
      <tr>
        <td>${escapeHtml(item.variety || "-")}</td>
        <td>${escapeHtml(item.sowDate || "-")}</td>
        <td>${escapeHtml(item.planPlantDate || "-")}</td>
        <td>
          <input type="number" min="0" step="1" class="form-input plan-assigned-tray-input" data-id="${escapeAttr(item.id)}" value="${Math.round(getAssignedTrayCount(item))}">
          <div class="plan-sub">全${Number(item.trayCount || 0).toLocaleString()}枚</div>
        </td>
        <td>${getAssignedPlants(item).toLocaleString()}</td>
        <td>
          <button type="button" class="secondary-btn plan-update-btn" data-id="${escapeAttr(item.id)}">更新</button>
          <button type="button" class="secondary-btn plan-remove-btn" data-id="${escapeAttr(item.id)}">削除</button>
        </td>
      </tr>
    `).join("")
    : `<tr><td colspan="6" style="text-align:center; color:#666;">まだ割当がありません</td></tr>`;

  showInfoModal(
    `定植計画：${fieldName}`,
    `
      <div class="plant-plan-modal">
        <div class="plan-group plan-group-metrics">
          <p class="plan-metric-row"><strong>耕作面積（反）：</strong> ${areaText}</p>
          <div class="plan-spacing-row">
            <label>畝間(cm)</label>
            <input id="plan-bed-spacing" class="form-input" type="number" min="1" step="1" value="${DEFAULT_BED_SPACING_CM}">
            <label>株間(cm)</label>
            <input id="plan-plant-spacing" class="form-input" type="number" min="1" step="1" value="${DEFAULT_PLANT_SPACING_CM}">
          </div>
          <p class="plan-metric-row"><strong>定植可能枚数（128穴/200穴）：</strong> <span id="plan-required-tray128">${requiredTray128Text}</span> 枚 / <span id="plan-required-tray200">${requiredTray200Text}</span> 枚</p>
          <p class="plan-metric-row"><strong>候補基準の定植可能枚数：</strong> <span id="plan-capacity-by-selected">-</span></p>
        </div>

        <div class="plant-plan-picker plan-group plan-group-picker">
          <label>播種計画（候補選択）</label>
          <div id="plan-selected-seed-summary" class="plan-selected-seed-summary">未選択</div>
          <button type="button" id="plan-open-seed-modal" class="secondary-btn">播種候補を開く</button>
          <div id="plan-seed-submodal" class="plan-seed-submodal" style="display:none;">
            <div class="plan-seed-submodal-panel">
              <div class="plan-seed-submodal-head">
                <strong>播種候補を選択</strong>
                <button type="button" id="plan-seed-submodal-close" class="secondary-btn">閉じる</button>
              </div>
              <div class="plan-seed-filters">
                <input id="plan-seed-keyword" class="form-input" type="text" placeholder="品種名で絞り込み">
                <select id="plan-seed-month" class="form-input">
                  <option value="">定植予定月: すべて</option>
                  ${seedMonthOptions.map(v => `<option value="${escapeAttr(v)}">${escapeHtml(v)}</option>`).join("")}
                </select>
                <label class="plan-seed-toggle"><input id="plan-seed-only-available" type="checkbox" checked> 残りありのみ</label>
              </div>
              <div id="plan-seed-count" class="plan-sub"></div>
              <div class="plan-seed-candidate-wrap">
                <table class="plant-plan-table plan-seed-candidate-table">
                  <thead>
                    <tr><th>定植予定</th><th>品種</th><th>残/全</th><th>トレイ</th></tr>
                  </thead>
                  <tbody id="plan-seed-candidate-body"></tbody>
                </table>
              </div>
              <div class="plan-seed-submodal-foot">
                <button type="button" id="plan-seed-submodal-apply" class="primary-btn">この候補を採用</button>
              </div>
            </div>
          </div>
          <label>この圃場へ割り当てる定植枚数</label>
          <input id="plan-seed-assign-trays" class="form-input" type="number" min="1" step="1" value="${defaultAssignableByField}">
          <div id="plan-seed-remaining-note" class="plan-sub plan-limit-note"></div>
          <button type="button" id="plan-seed-add" class="primary-btn" ${seedPlanRows.length ? "" : "disabled"}>この圃場に反映（未保存）</button>
        </div>

        <table class="plant-plan-table plan-group plan-group-assignment">
          <thead>
            <tr><th>品種</th><th>播種日</th><th>定植予定日</th><th>トレイ</th><th>株数</th><th>操作</th></tr>
          </thead>
          <tbody>${assignmentRows}</tbody>
        </table>

        <p class="plan-metric-row plan-allocation-total"><strong>割り当て合計（未保存）：</strong> ${plannedPlants.toLocaleString()} 株 / ${plannedTrays.toLocaleString()} 枚</p>
      </div>
    `
  );

  const planDialog = document.querySelector("#info-modal-bg .modal");
  if (planDialog) {
    planDialog.classList.add("plant-plan-dialog");
  }

  const addBtn = document.getElementById("plan-seed-add");
  const selectedSeedSummaryEl = document.getElementById("plan-selected-seed-summary");
  const openSeedModalBtn = document.getElementById("plan-open-seed-modal");
  const seedSubmodalEl = document.getElementById("plan-seed-submodal");
  const seedSubmodalCloseBtn = document.getElementById("plan-seed-submodal-close");
  const seedSubmodalApplyBtn = document.getElementById("plan-seed-submodal-apply");
  const seedCandidateBodyEl = document.getElementById("plan-seed-candidate-body");
  const seedKeywordEl = document.getElementById("plan-seed-keyword");
  const seedMonthEl = document.getElementById("plan-seed-month");
  const seedOnlyAvailableEl = document.getElementById("plan-seed-only-available");
  const seedCountEl = document.getElementById("plan-seed-count");
  const assignTraysInput = document.getElementById("plan-seed-assign-trays");
  const remainingNoteEl = document.getElementById("plan-seed-remaining-note");
  const bedInput = document.getElementById("plan-bed-spacing");
  const plantInput = document.getElementById("plan-plant-spacing");
  const requiredTray128El = document.getElementById("plan-required-tray128");
  const requiredTray200El = document.getElementById("plan-required-tray200");
  const capacityBySelectedEl = document.getElementById("plan-capacity-by-selected");
  let selectedSeedId = "";
  let draftSelectedSeedId = "";

  const updateBaseRequirementView = () => {
    if (!bedInput || !plantInput || !requiredTray128El || !requiredTray200El) return;
    const bedCm = Number(bedInput.value || 0);
    const plantCm = Number(plantInput.value || 0);
    const required = calcBaseRequirement(fieldName, bedCm, plantCm);
    requiredTray128El.textContent = required.valid ? required.requiredTray128.toLocaleString() : "-";
    requiredTray200El.textContent = required.valid ? required.requiredTray200.toLocaleString() : "-";
    updateSelectedSeedRemainingView();
  };

  if (bedInput) bedInput.addEventListener("input", updateBaseRequirementView);
  if (plantInput) plantInput.addEventListener("input", updateBaseRequirementView);

  const sortedSeedRows = seedPlanRows
    .slice()
    .sort((a, b) => String(a.planPlantDate || "").localeCompare(String(b.planPlantDate || "")) || String(a.variety || "").localeCompare(String(b.variety || ""), "ja"));

  const renderSeedOptions = () => {
    if (!seedCandidateBodyEl) return;
    const prev = String(draftSelectedSeedId || "").trim();
    const keyword = String(seedKeywordEl?.value || "").trim().toLowerCase();
    const month = String(seedMonthEl?.value || "").trim();
    const onlyAvailable = !!seedOnlyAvailableEl?.checked;

    const rowsHtml = [];
    const candidateIds = [];
    sortedSeedRows.forEach(item => {
      const id = String(item.id || "").trim();
      const variety = String(item.variety || "").trim();
      const planDate = String(item.planPlantDate || "").trim();
      const monthKey = planDate.slice(0, 7);
      const remaining = getRemainingTrays(item.id, item.trayCount);
      const disabled = remaining <= 0;

      if (keyword && !`${variety} ${id}`.toLowerCase().includes(keyword)) return;
      if (month && monthKey !== month) return;
      if (onlyAvailable && disabled) return;

      const selectedClass = id === prev ? " is-selected" : "";
      rowsHtml.push(`
        <tr class="plan-seed-row${selectedClass}${disabled ? " is-disabled" : ""}" data-id="${escapeAttr(id)}" data-disabled="${disabled ? "1" : "0"}">
          <td>${escapeHtml(planDate || "-")}</td>
          <td>${escapeHtml(variety || "(品種未設定)")}</td>
          <td>${remaining.toLocaleString()} / ${Number(item.trayCount || 0).toLocaleString()}枚</td>
          <td>${escapeHtml(String(item.trayType || "tray"))}</td>
        </tr>
      `);
      if (!disabled) candidateIds.push(id);
    });

    if (rowsHtml.length === 0) {
      seedCandidateBodyEl.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#666;">条件に一致する候補がありません</td></tr>`;
      selectedSeedId = "";
      if (addBtn) addBtn.disabled = true;
      if (seedCountEl) seedCountEl.textContent = "候補: 0件";
      return;
    }

    seedCandidateBodyEl.innerHTML = rowsHtml.join("");
    draftSelectedSeedId = candidateIds.includes(prev) ? prev : (candidateIds[0] || "");

    seedCandidateBodyEl.querySelectorAll(".plan-seed-row").forEach(row => {
      const id = String(row.dataset.id || "").trim();
      const disabled = String(row.dataset.disabled || "") === "1";
      if (id === draftSelectedSeedId) row.classList.add("is-selected");
      row.addEventListener("click", () => {
        if (disabled) return;
        draftSelectedSeedId = id;
        seedCandidateBodyEl.querySelectorAll(".plan-seed-row").forEach(r => r.classList.remove("is-selected"));
        row.classList.add("is-selected");
      });
    });

    if (seedSubmodalApplyBtn) seedSubmodalApplyBtn.disabled = !draftSelectedSeedId;
    if (seedCountEl) seedCountEl.textContent = `候補: ${rowsHtml.length.toLocaleString()}件`;
  };

  const updateSelectedSeedSummary = () => {
    if (!selectedSeedSummaryEl) return;
    const id = String(selectedSeedId || "").trim();
    const picked = getSeedPlanById(id);
    if (!picked) {
      selectedSeedSummaryEl.textContent = "未選択";
      if (addBtn) addBtn.disabled = true;
      return;
    }
    const remaining = getRemainingTrays(picked.id, picked.trayCount);
    selectedSeedSummaryEl.textContent = `${picked.planPlantDate || "-"} ｜ ${picked.variety || "(品種未設定)"} ｜ 残${remaining.toLocaleString()} / 全${Number(picked.trayCount || 0).toLocaleString()}枚（${picked.trayType || "tray"}）`;
    if (addBtn) addBtn.disabled = false;
  };

  const updateSelectedSeedRemainingView = (applySuggestedDefault = false) => {
    if (!assignTraysInput || !remainingNoteEl) return;
    const id = String(selectedSeedId || "").trim();
    const picked = getSeedPlanById(id);
    if (!picked) {
      remainingNoteEl.textContent = "";
      assignTraysInput.value = "0";
      if (capacityBySelectedEl) capacityBySelectedEl.textContent = "-";
      return;
    }

    const remaining = getRemainingTrays(picked.id, picked.trayCount);
    const cells = parseTrayCells(picked.trayType);
    const bedCm = Number(bedInput?.value || 0);
    const plantCm = Number(plantInput?.value || 0);
    const capacityPlants = getFieldCapacityPlants(fieldName, bedCm, plantCm);
    const assignedPlantsExcluding = getAssignedPlantsTotal(assignments, { excludeId: id });
    const fieldRemainPlants = Math.max(0, capacityPlants - assignedPlantsExcluding);
    const fieldRemainTrays = Math.floor(fieldRemainPlants / Math.max(1, cells));
    const maxAssignable = Math.max(0, Math.min(remaining, fieldRemainTrays));
    if (capacityBySelectedEl) {
      capacityBySelectedEl.textContent = `${fieldRemainTrays.toLocaleString()}枚（${picked.trayType || "tray"}）`;
    }
    remainingNoteEl.textContent = `入力上限 ${maxAssignable.toLocaleString()}枚（播種ID残 ${remaining.toLocaleString()} / 圃場残 ${fieldRemainTrays.toLocaleString()}）`;
    const currentInput = Math.floor(Number(assignTraysInput.value || 0));
    if (applySuggestedDefault) {
      assignTraysInput.value = String(maxAssignable > 0 ? maxAssignable : 0);
    } else if (!(currentInput > 0)) {
      assignTraysInput.value = String(fieldRemainTrays > 0 ? fieldRemainTrays : 0);
    }
  };

  if (openSeedModalBtn && seedSubmodalEl) {
    openSeedModalBtn.addEventListener("click", () => {
      draftSelectedSeedId = String(selectedSeedId || "").trim();
      renderSeedOptions();
      seedSubmodalEl.style.display = "flex";
    });
  }

  const closeSeedSubmodal = () => {
    if (!seedSubmodalEl) return;
    seedSubmodalEl.style.display = "none";
  };

  if (seedSubmodalCloseBtn) {
    seedSubmodalCloseBtn.addEventListener("click", closeSeedSubmodal);
  }

  if (seedSubmodalApplyBtn) {
    seedSubmodalApplyBtn.addEventListener("click", () => {
      selectedSeedId = String(draftSelectedSeedId || "").trim();
      updateSelectedSeedSummary();
      updateSelectedSeedRemainingView(true);
      closeSeedSubmodal();
    });
  }

  selectedSeedId = String(seedPlanRows[0]?.id || "").trim();
  draftSelectedSeedId = selectedSeedId;
  updateSelectedSeedSummary();
  updateSelectedSeedRemainingView(true);

  if (seedKeywordEl) {
    seedKeywordEl.addEventListener("input", () => {
      renderSeedOptions();
      updateSelectedSeedRemainingView();
    });
  }
  if (seedMonthEl) {
    seedMonthEl.addEventListener("change", () => {
      renderSeedOptions();
      updateSelectedSeedRemainingView();
    });
  }
  if (seedOnlyAvailableEl) {
    seedOnlyAvailableEl.addEventListener("change", () => {
      renderSeedOptions();
      updateSelectedSeedRemainingView();
    });
  }

  if (addBtn) {
    addBtn.onclick = () => {
      const id = String(selectedSeedId || "").trim();
      if (!id) return;
      const picked = getSeedPlanById(id);
      if (!picked) return;

      const requested = Math.floor(Number(assignTraysInput?.value || 0));
      if (!(requested > 0)) {
        alert("割当枚数を入力してください。");
        return;
      }

      const maxBySeed = getRemainingTrays(picked.id, picked.trayCount);
      const bedCm = Number(bedInput?.value || 0);
      const plantCm = Number(plantInput?.value || 0);
      const capacityPlants = getFieldCapacityPlants(fieldName, bedCm, plantCm);
      if (capacityPlants <= 0) {
        alert("圃場面積または株間/畝間の設定を確認してください。");
        return;
      }
      const assignedPlantsExcluding = getAssignedPlantsTotal(assignments, { excludeId: picked.id });
      const remainPlantsByField = Math.max(0, capacityPlants - assignedPlantsExcluding);
      const cells = parseTrayCells(picked.trayType);
      const maxByField = Math.floor(remainPlantsByField / Math.max(1, cells));
      const maxAssignable = Math.max(0, Math.min(maxBySeed, maxByField));

      if (maxAssignable <= 0) {
        alert("この播種IDは割当可能な残枚数がありません。");
        return;
      }

      if (requested > maxAssignable) {
        alert(`割当上限は ${maxAssignable.toLocaleString()} 枚です。`);
        return;
      }

      upsertAssignment(fieldName, picked, requested);
      openPlantingPlanModal(fieldName);
      renderFieldCards(applyAllFilters(plantingRows, window.currentFilterState || {}), window.currentFilterState || {});
    };
  }

  document.querySelectorAll(".plan-update-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = String(btn.dataset.id || "").trim();
      if (!id) return;

      const input = Array.from(document.querySelectorAll(".plan-assigned-tray-input")).find(el => String(el.dataset.id || "") === id);
      const requested = Math.floor(Number(input?.value || 0));
      if (!(requested >= 0)) {
        alert("更新枚数を確認してください。");
        return;
      }

      const picked = getSeedPlanById(id);
      if (!picked) {
        alert("播種計画IDが見つかりません。");
        return;
      }

      if (requested === 0) {
        removeAssignment(fieldName, id);
        openPlantingPlanModal(fieldName);
        renderFieldCards(applyAllFilters(plantingRows, window.currentFilterState || {}), window.currentFilterState || {});
        return;
      }

      const maxBySeed = getRemainingTrays(id, picked.trayCount, { excludeField: fieldName, excludeId: id });
      const bedCm = Number(bedInput?.value || 0);
      const plantCm = Number(plantInput?.value || 0);
      const capacityPlants = getFieldCapacityPlants(fieldName, bedCm, plantCm);
      if (capacityPlants <= 0) {
        alert("圃場面積または株間/畝間の設定を確認してください。");
        return;
      }
      const assignedPlantsExcluding = getAssignedPlantsTotal(assignments, { excludeId: id });
      const remainPlantsByField = Math.max(0, capacityPlants - assignedPlantsExcluding);
      const cells = parseTrayCells(picked.trayType);
      const maxByField = Math.floor(remainPlantsByField / Math.max(1, cells));
      const maxAssignable = Math.max(0, Math.min(maxBySeed, maxByField));

      if (requested > maxAssignable) {
        alert(`割当上限は ${maxAssignable.toLocaleString()} 枚です。`);
        return;
      }

      upsertAssignment(fieldName, picked, requested);
      openPlantingPlanModal(fieldName);
      renderFieldCards(applyAllFilters(plantingRows, window.currentFilterState || {}), window.currentFilterState || {});
    });
  });

  document.querySelectorAll(".plan-remove-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = String(btn.dataset.id || "").trim();
      removeAssignment(fieldName, id);
      openPlantingPlanModal(fieldName);
      renderFieldCards(applyAllFilters(plantingRows, window.currentFilterState || {}), window.currentFilterState || {});
    });
  });
}

function renderTable(rows) {

  let html = `
    <table>
      <thead>
        <tr>
          <th>定植日</th>
          <th>圃場</th>
          <th>品種</th>
          <th>面積(反)</th>
          <th>播種日</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
  `;

  let totalQuantity = 0;
  let totalAreaTan = 0;

  rows.forEach(r => {

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
      <td><a href="/fields/variety.html?variety=${encodeURIComponent(r.variety)}">${r.variety}</a></td>
      <td>${areaTan.toFixed(2)}</td>
      <td>${getSeedDates(r.seedRef)}</td>
      <td>${canDiscard && ref ? `<button class="primary-btn discard-btn" data-ref="${ref}">破棄</button>` : ""}</td>
    </tr>`;
  });

  html += `
      </tbody>
    </table>
  `;

  // ▼ planting モード用の summary 表示（seed 専用 summaryArea は使わない）
  const summary = document.getElementById("summaryArea");
  if (summary) {
    summary.innerHTML =
      `株数合計：${totalQuantity.toLocaleString()} 株　
       面積合計：${totalAreaTan.toFixed(2)} 反`;
  }

  tableArea.innerHTML = html;

  /* ▼ 定植日クリックでモーダル */
  document.querySelectorAll(".plant-date-cell").forEach(cell => {
    cell.addEventListener("click", () => {
      const ref = cell.dataset.id;
      const data = getPlantDetail(ref);
      showInfoModal(data.title, data.html);
    });
  });

  /* ▼ 破棄ボタン */
  document.querySelectorAll(".discard-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const ref = btn.dataset.ref;
      location.href = `/planting/discard-planting.html?ref=${encodeURIComponent(ref)}`;
    });
  });
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
  return escapeHtml(value).replace(/`/g, "&#96;");
}
