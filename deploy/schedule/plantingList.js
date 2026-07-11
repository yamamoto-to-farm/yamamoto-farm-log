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
const planningAssignments = new Map(); // fieldName -> [{ id, variety, sowDate, trayType, trayCount, plants }]
const areaExpandState = new Map(); // areaName -> boolean
const DEFAULT_BED_SPACING_CM = 60;
const DEFAULT_PLANT_SPACING_CM = 33;
const ACTUAL_WINDOW_MONTHS = 1;

let filterData = {};
let initialized = false;

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

  const selectedYear = getSelectedPlanningYear();
  if (selectedYear !== seedPlanYearLoaded) {
    seedPlanRows = await loadSeedPlanRows(selectedYear);
    seedPlanYearLoaded = selectedYear;
  }

  const state = window.currentFilterState || {};
  const filteredPlantingRows = applyAllFilters(plantingRows, state);
  renderFieldCards(filteredPlantingRows, state);
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

  seedPlanYearLoaded = getSelectedPlanningYear();
  seedPlanRows = await loadSeedPlanRows(seedPlanYearLoaded);

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

  // ▼ フィルタボタン（存在チェック付き）
  const yearBtn = document.querySelector('[data-type="year"]');
  if (yearBtn) yearBtn.addEventListener("click", openYearModal);

  const fieldBtn = document.querySelector('[data-type="field"]');
  if (fieldBtn) fieldBtn.addEventListener("click", openFieldModal);

  const varietyBtn = document.querySelector('[data-type="variety"]');
  if (varietyBtn) varietyBtn.addEventListener("click", openVarietyModal);

  window.addEventListener("filter:apply", (e) => {
    window.currentFilterState = e.detail;
    renderFieldCards(applyAllFilters(plantingRows, e.detail), e.detail);
  });

  window.addEventListener("filter:reset", () => {
    window.currentFilterState = {};
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

  const targetFields = getTargetFields(rows, state);
  if (!targetFields.length) {
    tableArea.innerHTML = `<div class="card"><p>対象の圃場がありません。</p></div>`;
    const summary = document.getElementById("summaryArea");
    if (summary) {
      summary.textContent = "表示圃場：0件";
    }
    return;
  }

  let html = "";
  let totalAssignedPlants = 0;
  let totalAssignedTrays = 0;

  const grouped = new Map();
  targetFields.forEach(field => {
    const areaName = String(field.area || "その他").trim() || "その他";
    if (!grouped.has(areaName)) grouped.set(areaName, []);
    grouped.get(areaName).push(field);
  });

  html += `<section class="card planting-field-group"><h3 class="section-title">圃場ごとの定植計画（行クリックで編集）</h3></section>`;

  grouped.forEach((fields, areaName) => {
    const expanded = getAreaExpanded(areaName);

    html += `
      <section class="card planting-area-group">
        <h4 class="section-title planting-area-title" data-area="${escapeAttr(areaName)}">${expanded ? "▼" : "▶"} ${escapeHtml(areaName)}（${fields.length}圃場）</h4>
        <div class="planting-area-body" style="display:${expanded ? "block" : "none"}">
          <table class="planting-plan-table">
            <colgroup>
              <col style="width:24%">
              <col style="width:16%">
              <col style="width:18%">
              <col style="width:20%">
              <col style="width:22%">
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
    const plannedPlants = assignments.reduce((acc, item) => acc + Number(item.plants || 0), 0);
    const plannedTrays = assignments.reduce((acc, item) => acc + Number(item.trayCount || 0), 0);
    totalAssignedPlants += plannedPlants;
    totalAssignedTrays += plannedTrays;

    const assignmentRows = buildAssignmentDisplayRows(assignments);
    const whenHtml = assignmentRows.datesHtml;
    const whatHtml = assignmentRows.varietiesHtml;
    const planTraySummary = buildPlanTraySummary(assignments);
    const planRowsHtml = planTraySummary.itemLinesHtml;
    const isUnset = assignments.length === 0 || (plannedPlants <= 0 && plannedTrays <= 0);
    const unsetClass = isUnset ? "is-unset" : "is-set";

    html += `
      <tr class="planting-plan-row ${isUnset ? "row-unset" : ""}" data-field="${escapeAttr(fieldName)}">
        <td>
          <strong>${escapeHtml(fieldName)}</strong><span class="planting-badge">候補 ${assignments.length}件</span>
          <div class="field-sub">${escapeHtml(String(field.area || "その他"))}</div>
        </td>
        <td>
          <span class="plan-chip ${unsetClass}">${assignments.length ? `${assignments.length}件` : "未設定"}</span>
          <div class="plan-sub plan-lines">${whenHtml}</div>
        </td>
        <td>
          <span class="plan-chip ${unsetClass}">${assignments.length ? `${assignmentRows.uniqueVarietyCount}品種` : "未設定"}</span>
          <div class="plan-sub plan-lines">${whatHtml}</div>
        </td>
        <td>
          <span class="plan-chip ${unsetClass}">${planTraySummary.totalTrays.toLocaleString()}枚 / ${planTraySummary.totalPlants.toLocaleString()}株</span>
          <div class="plan-sub plan-lines">${planRowsHtml}</div>
          <div class="plan-sub">作付面積: ${planTraySummary.areaTan.toFixed(2)}反</div>
        </td>
        <td>
          <div><strong>直近定植日:</strong> ${escapeHtml(actualSummary.latestDate || "-")}</div>
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

  tableArea.innerHTML = html;

  document.querySelectorAll(".planting-area-title").forEach(el => {
    el.addEventListener("click", () => {
      const areaName = String(el.dataset.area || "").trim();
      if (!areaName) return;
      areaExpandState.set(areaName, !getAreaExpanded(areaName));
      renderFieldCards(rows, state);
    });
  });

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

function getAreaExpanded(areaName) {
  if (!areaExpandState.has(areaName)) {
    areaExpandState.set(areaName, true);
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
      const trayCount = Number(item.trayCount || 0);
      const trayType = String(item.trayType || "").trim() || "tray未設定";
      const plants = Number(item.plants || 0);
      const variety = String(item.variety || "").trim() || "(品種未設定)";
      return `<div class="plan-line">${escapeHtml(variety)}: ${Math.round(trayCount).toLocaleString()}枚（${escapeHtml(trayType)}） / ${Math.round(plants).toLocaleString()}株</div>`;
    })
    .join("");

  const byTrayType = new Map();

  assignments.forEach(item => {
    const trayType = String(item.trayType || "").trim() || "tray未設定";
    const trayCount = Number(item.trayCount || 0);
    const plants = Number(item.plants || 0);
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

function openPlantingPlanModal(fieldName) {
  const assignments = planningAssignments.get(fieldName) || [];
  const plannedPlants = assignments.reduce((acc, item) => acc + Number(item.plants || 0), 0);
  const plannedTrays = assignments.reduce((acc, item) => acc + Number(item.trayCount || 0), 0);
  const baseRequirement = calcBaseRequirement(fieldName, DEFAULT_BED_SPACING_CM, DEFAULT_PLANT_SPACING_CM);
  const areaText = baseRequirement.areaA > 0 ? `${baseRequirement.areaA.toLocaleString()}a` : "未設定";
  const requiredPlantsText = baseRequirement.valid ? baseRequirement.requiredPlants.toLocaleString() : "-";
  const requiredTray128Text = baseRequirement.valid ? baseRequirement.requiredTray128.toLocaleString() : "-";
  const requiredTray200Text = baseRequirement.valid ? baseRequirement.requiredTray200.toLocaleString() : "-";

  const optionsHtml = seedPlanRows.length
    ? seedPlanRows.map(item => `
        <option value="${escapeAttr(item.id)}">${escapeHtml(item.variety || "(品種未設定)")} / 播種:${escapeHtml(item.sowDate || "-")} / 定植:${escapeHtml(item.planPlantDate || "-")} / ${escapeHtml(item.trayCount)}枚(${escapeHtml(item.trayType || "tray")})</option>
      `).join("")
    : `<option value="">播種計画がありません</option>`;

  const assignmentRows = assignments.length
    ? assignments.map(item => `
      <tr>
        <td>${escapeHtml(item.variety || "-")}</td>
        <td>${escapeHtml(item.sowDate || "-")}</td>
        <td>${escapeHtml(item.planPlantDate || "-")}</td>
        <td>${Number(item.trayCount || 0).toLocaleString()}</td>
        <td>${Number(item.plants || 0).toLocaleString()}</td>
        <td><button type="button" class="secondary-btn plan-remove-btn" data-id="${escapeAttr(item.id)}">削除</button></td>
      </tr>
    `).join("")
    : `<tr><td colspan="6" style="text-align:center; color:#666;">まだ割当がありません</td></tr>`;

  showInfoModal(
    `定植計画：${fieldName}`,
    `
      <div class="plant-plan-modal">
        <p><strong>圃場面積：</strong> ${areaText}</p>
        <p>
          <label>畝間(cm)</label>
          <input id="plan-bed-spacing" class="form-input" type="number" min="1" step="1" value="${DEFAULT_BED_SPACING_CM}">
          <label>株間(cm)</label>
          <input id="plan-plant-spacing" class="form-input" type="number" min="1" step="1" value="${DEFAULT_PLANT_SPACING_CM}">
        </p>
        <p><strong>必要株数（1作ベース）：</strong> <span id="plan-required-plants">${requiredPlantsText}</span> 株</p>
        <p><strong>必要トレイ枚数（128穴/200穴）：</strong> <span id="plan-required-tray128">${requiredTray128Text}</span> 枚 / <span id="plan-required-tray200">${requiredTray200Text}</span> 枚</p>
        <p><strong>割当合計（未保存）：</strong> ${plannedPlants.toLocaleString()} 株 / ${plannedTrays.toLocaleString()} 枚</p>

        <div class="plant-plan-picker">
          <label>播種計画から選択</label>
          <select id="plan-seed-select" class="form-input">${optionsHtml}</select>
          <button type="button" id="plan-seed-add" class="primary-btn" ${seedPlanRows.length ? "" : "disabled"}>この圃場に反映（未保存）</button>
        </div>

        <table class="plant-plan-table">
          <thead>
            <tr><th>品種</th><th>播種日</th><th>定植予定日</th><th>トレイ</th><th>株数</th><th>操作</th></tr>
          </thead>
          <tbody>${assignmentRows}</tbody>
        </table>
      </div>
    `
  );

  const addBtn = document.getElementById("plan-seed-add");
  const selectEl = document.getElementById("plan-seed-select");
  const bedInput = document.getElementById("plan-bed-spacing");
  const plantInput = document.getElementById("plan-plant-spacing");
  const requiredPlantsEl = document.getElementById("plan-required-plants");
  const requiredTray128El = document.getElementById("plan-required-tray128");
  const requiredTray200El = document.getElementById("plan-required-tray200");

  const updateBaseRequirementView = () => {
    if (!bedInput || !plantInput || !requiredPlantsEl || !requiredTray128El || !requiredTray200El) return;
    const bedCm = Number(bedInput.value || 0);
    const plantCm = Number(plantInput.value || 0);
    const required = calcBaseRequirement(fieldName, bedCm, plantCm);
    requiredPlantsEl.textContent = required.valid ? required.requiredPlants.toLocaleString() : "-";
    requiredTray128El.textContent = required.valid ? required.requiredTray128.toLocaleString() : "-";
    requiredTray200El.textContent = required.valid ? required.requiredTray200.toLocaleString() : "-";
  };

  if (bedInput) bedInput.addEventListener("input", updateBaseRequirementView);
  if (plantInput) plantInput.addEventListener("input", updateBaseRequirementView);

  if (addBtn && selectEl) {
    addBtn.onclick = () => {
      const id = String(selectEl.value || "").trim();
      if (!id) return;
      const picked = seedPlanRows.find(v => v.id === id);
      if (!picked) return;

      const next = [...(planningAssignments.get(fieldName) || [])];
      if (!next.some(v => v.id === picked.id)) {
        next.push({ ...picked });
        planningAssignments.set(fieldName, next);
      }
      openPlantingPlanModal(fieldName);
      renderFieldCards(applyAllFilters(plantingRows, window.currentFilterState || {}), window.currentFilterState || {});
    };
  }

  document.querySelectorAll(".plan-remove-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = String(btn.dataset.id || "").trim();
      const next = [...(planningAssignments.get(fieldName) || [])].filter(v => v.id !== id);
      planningAssignments.set(fieldName, next);
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
