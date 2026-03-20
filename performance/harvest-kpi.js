// harvest-kpi.js

import { loadCSV } from "/yamamoto-farm-log/common/csv.js?v=1";

// ------------------------------
// 1. JSON / CSV を読み込む
// ------------------------------
async function loadHarvestBase() {
  const res = await fetch(`/yamamoto-farm-log/data/harvestBase.json`);
  return await res.json();
}

async function loadSummaryIndex() {
  const res = await fetch(`/yamamoto-farm-log/data/summary-index.json`);
  return await res.json();
}

async function loadHarvestCSV() {
  return await loadCSV(`/yamamoto-farm-log/data/harvest.csv`);
}

// ------------------------------
// 2. 月別の予定面積を集計
// ------------------------------
function calcPlannedArea(summaryIndex) {
  const monthly = Array(12).fill(0);

  summaryIndex.forEach(item => {
    const m = Number(item.month) - 1;
    if (m >= 0 && m < 12) {
      monthly[m] += Number(item.area_tan || 0);
    }
  });

  return monthly;
}

// ------------------------------
// 3. 月別の実績（面積・kg・基数）を集計
// ------------------------------
function calcActuals(harvestRows) {
  const area = Array(12).fill(0);
  const kg = Array(12).fill(0);
  const units = Array(12).fill(0);

  harvestRows.forEach(row => {
    const m = Number(row.month) - 1;
    if (m < 0 || m >= 12) return;

    area[m] += Number(row.area_tan || 0);
    kg[m] += Number(row.weight || 0);
    units[m] += Number(row.units || 0);
  });

  return { area, kg, units };
}

// ------------------------------
// 4. 月別の目標値（kg・基数）を計算
// ------------------------------
function calcTargets(plannedArea, harvestBase) {
  const targetKg = Array(12).fill(0);
  const targetUnits = Array(12).fill(0);

  for (let m = 0; m < 12; m++) {
    const base = harvestBase[m + 1]; // harvestBase は 1〜12 月
    if (!base) continue;

    targetKg[m] = plannedArea[m] * Number(base.yieldPerTan || 0);
    targetUnits[m] = plannedArea[m] * Number(base.unitsPerTan || 0);
  }

  return { targetKg, targetUnits };
}

// ------------------------------
// 5. テーブルに反映
// ------------------------------
function renderTable(plannedArea, actuals, targets) {
  const tbody = document.getElementById("kpi-body");

  for (let m = 0; m < 12; m++) {
    const diff = actuals.area[m] - plannedArea[m];

    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td style="text-align:center;">${m + 1}月</td>
      <td>${plannedArea[m].toFixed(2)}</td>
      <td>${actuals.area[m].toFixed(2)}</td>
      <td class="${diff > 0 ? "diff-positive" : diff < 0 ? "diff-negative" : "diff-zero"}">
        ${diff > 0 ? "+" : ""}${diff.toFixed(2)}
      </td>
      <td>${targets.targetKg[m].toFixed(0)}</td>
      <td>${actuals.kg[m].toFixed(0)}</td>
      <td>${targets.targetUnits[m].toFixed(0)}</td>
      <td>${actuals.units[m].toFixed(0)}</td>
    `;

    tbody.appendChild(tr);
  }

  document.getElementById("loading").style.display = "none";
  document.getElementById("kpi-table").style.display = "table";
}

// ------------------------------
// 6. メイン処理
// ------------------------------
async function main() {
  const harvestBase = await loadHarvestBase();
  const summaryIndex = await loadSummaryIndex();
  const harvestRows = await loadHarvestCSV();

  const plannedArea = calcPlannedArea(summaryIndex);
  const actuals = calcActuals(harvestRows);
  const targets = calcTargets(plannedArea, harvestBase);

  renderTable(plannedArea, actuals, targets);
}

main();