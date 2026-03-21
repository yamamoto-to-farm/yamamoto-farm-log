// harvest-kpi.js

import { loadJSON } from "/yamamoto-farm-log/common/json.js?v=1.1";
import { loadCSV } from "/yamamoto-farm-log/common/csv.js?v=1.1";

// ------------------------------
// 1. JSON / CSV を読み込む
// ------------------------------
async function loadHarvestBase() {
  return await loadJSON(`data/harvestBase.json`);
}

async function loadSummaryIndex() {
  return await loadJSON(`data/summary-index.json`);
}

async function loadWeightCSV() {
  return await loadCSV(`logs/weight/all.csv`);
}

async function loadPlantingRef(path) {
  return await loadJSON(path);
}

// ------------------------------
// 2. summary-index.json を展開して一覧化
// ------------------------------
async function loadAllPlantingRefs() {
  const index = await loadSummaryIndex();
  const list = [];

  for (const fieldName in index) {
    const years = index[fieldName];

    for (const year in years) {
      const files = years[year];

      for (const fileName of files) {
        list.push({
          field: fieldName,
          year: year,
          file: fileName,
          plantingRef: fileName.replace(".json", "")
        });
      }
    }
  }

  return list;
}

// ------------------------------
// 3. 面積（反）を計算
// ------------------------------
function calcAreaTan(planting) {
  const qty = Number(planting.quantity || 0);
  const row = Number(planting.spacing.row || 0);
  const bed = Number(planting.spacing.bed || 0);

  return (qty * row * bed) / 1000000;
}

// ------------------------------
// 4. plantingRef ごとの月別重量を集計
// ------------------------------
function groupWeightByRef(weightRows) {
  const map = {};

  weightRows.forEach(row => {
    const ref = row.plantingRef;
    if (!ref) return;

    if (!map[ref]) {
      map[ref] = {
        monthlyKg: Array(12).fill(0),
        monthlyUnits: Array(12).fill(0),
        totalKg: 0
      };
    }

    const m = new Date(row.shippingDate).getMonth();

    const kg = Number(row.totalWeight || 0);
    const units = Number(row.bins || 0);

    map[ref].monthlyKg[m] += kg;
    map[ref].monthlyUnits[m] += units;
    map[ref].totalKg += kg;
  });

  return map;
}

// ------------------------------
// 5. 月別の目標値（kg・基数）
// ------------------------------
function calcTargets(areaMonthly, harvestBase) {
  const targetKg = Array(12).fill(0);
  const targetUnits = Array(12).fill(0);

  for (let m = 0; m < 12; m++) {
    const base = harvestBase[m + 1];
    if (!base) continue;

    targetKg[m] = areaMonthly[m] * Number(base.yieldPerTan || 0);
    targetUnits[m] = areaMonthly[m] * Number(base.unitsPerTan || 0);
  }

  return { targetKg, targetUnits };
}

// ------------------------------
// 6. テーブルに反映（予定→実績）
// ------------------------------
function renderTable(planArea, areaMonthly, actuals, targets) {
  const tbody = document.getElementById("kpi-body");

  for (let m = 0; m < 12; m++) {
    const diffKg = actuals.kg[m] - targets.targetKg[m];
    const diffUnits = actuals.units[m] - targets.targetUnits[m];

    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td style="text-align:center;">${m + 1}月</td>

      <td>${planArea[m].toFixed(2)}</td>
      <td>${areaMonthly[m].toFixed(2)}</td>

      <td>${targets.targetKg[m].toFixed(0)}</td>
      <td>${actuals.kg[m].toFixed(0)}</td>
      <td class="${diffKg > 0 ? "diff-positive" : diffKg < 0 ? "diff-negative" : "diff-zero"}">
        ${diffKg > 0 ? "+" : ""}${diffKg.toFixed(0)}
      </td>

      <td>${targets.targetUnits[m].toFixed(0)}</td>
      <td>${actuals.units[m].toFixed(0)}</td>
      <td class="${diffUnits > 0 ? "diff-positive" : diffUnits < 0 ? "diff-negative" : "diff-zero"}">
        ${diffUnits > 0 ? "+" : ""}${diffUnits.toFixed(0)}
      </td>
    `;

    tbody.appendChild(tr);
  }

  document.getElementById("loading").style.display = "none";
  document.getElementById("kpi-table").style.display = "table";
}

// ------------------------------
// 7. メイン処理（Promise.all で競合ゼロ）
// ------------------------------
async function main() {
  const harvestBase = await loadHarvestBase();
  const plantingList = await loadAllPlantingRefs();
  const weightRows = await loadWeightCSV();

  const weightMap = groupWeightByRef(weightRows);

  const areaMonthly = Array(12).fill(0);
  const planArea = Array(12).fill(0);

  const actuals = {
    kg: Array(12).fill(0),
    units: Array(12).fill(0)
  };

  // 実績（kg / 基）
  weightRows.forEach(row => {
    const m = new Date(row.shippingDate).getMonth();
    actuals.kg[m] += Number(row.totalWeight || 0);
    actuals.units[m] += Number(row.bins || 0);
  });

  // ★ plantingRef.json をすべて並列で読み込む
  const refDatas = await Promise.all(
    plantingList.map(item =>
      loadPlantingRef(`summary/${item.field}/${item.year}/${item.file}`)
    )
  );

  // ★ 読み込み済みの refDatas を使って計算
  for (let i = 0; i < plantingList.length; i++) {
    const item = plantingList[i];
    const refData = refDatas[i];

    const area = calcAreaTan(refData.planting);
    const w = weightMap[item.plantingRef];

    // 予定面積（harvestPlanYM）
    const ym = refData.planting.harvestPlanYM;
    if (ym) {
      const planMonth = Number(ym.split("-")[1]) - 1;
      planArea[planMonth] += area;
    }

    // 実績面積（重量按分）
    if (w && w.totalKg > 0) {
      for (let m = 0; m < 12; m++) {
        const ratio = w.monthlyKg[m] / w.totalKg;
        areaMonthly[m] += area * ratio;
      }
    }
  }

  const targets = calcTargets(areaMonthly, harvestBase);

  renderTable(planArea, areaMonthly, actuals, targets);
}

main();