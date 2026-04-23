// harvest-kpi.js
// ページ制御（最小限）

import { loadYearIndex, loadPlantingCSV, loadWeightCSV, loadSummaryJSON } from "./kpi-data-loader.js";
import { checkYearIndexNeedsUpdate, generateYearIndex, saveYearIndex } from "./kpi-year-index.js";
import { renderYearBlock, renderKpiTable } from "./kpi-render.js";
import {
  calcAreaTanFromPlantingRow,
  calcAreaTanFromSummaryPlanting,
  groupWeightByRef,
  calcTargets
} from "./kpi-utils.js";

// ===============================
// KPI ページ描画
// ===============================
export async function renderKpiPage() {
  const yearIndex = await loadYearIndex();

  // 更新チェック
  const needsUpdate = await checkYearIndexNeedsUpdate(yearIndex);
  if (needsUpdate) {
    document.getElementById("year-index-update-area").style.display = "block";
  }

  // 年一覧描画
  const years = Object.keys(yearIndex)
    .filter(y => y !== "lastSummaryIndexHash")
    .map(Number)
    .sort();

  let html = years.map(y => renderYearBlock(y)).join("");
  document.getElementById("kpi-container").innerHTML = html;

  // KPI 描画
  for (const year of years) {
    const container = document.getElementById(`kpi-${year}`);
    container.innerHTML = await renderKpiForYear(year, yearIndex[year]);
  }
}

// ===============================
// year-index.json 更新処理
// ===============================
export async function updateYearIndex() {
  const status = document.getElementById("update-status");
  status.textContent = "更新中...";

  try {
    const newIndex = await generateYearIndex();
    await saveYearIndex(newIndex);

    status.textContent = "更新完了！ページを再読み込みしてください。";
  } catch (e) {
    console.error(e);
    status.textContent = "更新に失敗しました。";
  }
}

// ===============================
// 年ごとの KPI 生成
// ===============================
async function renderKpiForYear(year, refList) {
  const plantingRows = await loadPlantingCSV();
  const weightRows = await loadWeightCSV();

  // weight → 実績
  const filteredWeightRows = weightRows.filter(row => {
    const d = new Date(row.shippingDate);
    return d.getFullYear() === year;
  });

  const weightMap = groupWeightByRef(filteredWeightRows, x => x);

  // ------------------------------
  // 予定面積（planting/all.csv ベース）
  // ------------------------------
  const planArea = Array(12).fill(0);

  plantingRows.forEach(row => {
    const ym = row.harvestPlanYM;
    if (!ym) return;

    const planYear = Number(ym.split("-")[0]);
    if (planYear !== year) return;

    const month = Number(ym.split("-")[1]) - 1;
    const area = calcAreaTanFromPlantingRow(row);

    planArea[month] += area;
  });

  // ------------------------------
  // 収穫面積（summary.json ベース）
  // ------------------------------
  const areaMonthly = Array(12).fill(0);
  const actuals = { kg: Array(12).fill(0), units: Array(12).fill(0) };

  filteredWeightRows.forEach(row => {
    const d = new Date(row.shippingDate);
    const m = d.getMonth();
    actuals.kg[m] += Number(row.totalWeight || 0);
    actuals.units[m] += Number(row.bins || 0);
  });

  // summary.json 読み込み
  const refDatas = await Promise.all(
    refList.map(item => {
      const path = `/logs/summary/${item.field}/${item.year}/${item.file}`;
      return loadSummaryJSON(path);
    })
  );

  for (let i = 0; i < refList.length; i++) {
    const item = refList[i];
    const summary = refDatas[i];

    const area = calcAreaTanFromSummaryPlanting(summary.planting);
    const w = weightMap[item.plantingRef];

    if (w && w.totalKg > 0) {
      for (let m = 0; m < 12; m++) {
        const ratio = w.monthlyKg[m] / w.totalKg;
        areaMonthly[m] += area * ratio;
      }
    }
  }

  // 目標値
  const harvestBase = await loadSummaryJSON("/data/harvestBase.json");
  const targets = calcTargets(planArea, harvestBase);

  return renderKpiTable(planArea, areaMonthly, actuals, targets, year);
}
