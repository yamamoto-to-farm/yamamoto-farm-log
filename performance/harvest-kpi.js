// harvest-kpi.js（デバッグ ON/OFF 付き）

import { loadJSON } from "/yamamoto-farm-log/common/json.js?v=1.1";
import { loadCSV } from "/yamamoto-farm-log/common/csv.js?v=1.1";
import { safeFileName } from "/yamamoto-farm-log/common/utils.js?v=1.1";

// ------------------------------
// デバッグ切り替え
// ------------------------------
const DEBUG = true;

function log(...args) {
  if (DEBUG) console.log(...args);
}

function logError(...args) {
  if (DEBUG) console.error(...args);
}

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
  log("🔍 loadPlantingRef(): 読み込み開始 →", path);
  try {
    const data = await loadJSON(path);
    log("✅ 読み込み成功 →", path);
    return data;
  } catch (e) {
    logError("❌ 読み込み失敗 →", path);
    throw e;
  }
}

// ------------------------------
// 2. summary-index.json を展開して一覧化
// ------------------------------
async function loadAllPlantingRefs() {
  const index = await loadSummaryIndex();
  log("📘 summary-index.json の内容:", index);

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
          plantingRef: safeFileName(fileName.replace(".json", ""))
        });
      }
    }
  }

  log("🧩 summary 側 plantingRef 一覧:", list.map(x => x.plantingRef));
  return list;
}

// ------------------------------
// 3. 面積（反）を計算（10倍問題修正）
// ------------------------------
function calcAreaTan(planting) {
  const qty = Number(planting.quantity || 0);
  const row = Number(planting.spacing.row || 0); // cm
  const bed = Number(planting.spacing.bed || 0); // cm

  // cm² → m² → 反（1000m²）
  return (qty * row * bed) / 10000000;
}

// ------------------------------
// 4. plantingRef ごとの月別重量を集計（CSV 側を逆変換）
// ------------------------------
function groupWeightByRef(weightRows) {
  const map = {};

  weightRows.forEach(row => {
    const ref = safeFileName(row.plantingRef);

    if (!ref) {
      logError("⚠ CSV に plantingRef が入っていない行:", row);
      return;
    }

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

  log("🧩 CSV 側 plantingRef（正規化後）一覧:", Object.keys(map));
  return map;
}

// ------------------------------
// 5. 月別の目標値（kg・基数）
// ------------------------------
function calcTargets(planArea, harvestBase) {
  const targetKg = Array(12).fill(0);
  const targetUnits = Array(12).fill(0);

  for (let m = 0; m < 12; m++) {
    const key = String(m + 1).padStart(2, "0");
    const base = harvestBase.monthly[key];

    if (!base) continue;

    targetKg[m] = planArea[m] * Number(base.yieldPerTan || 0);
    targetUnits[m] = planArea[m] * Number(base.unitsPerTan || 0);
  }

  return { targetKg, targetUnits };
}

// ------------------------------
// 6. テーブルに反映（カンマ区切り対応）
// ------------------------------
function renderTable(planArea, areaMonthly, actuals, targets) {
  const tbody = document.getElementById("kpi-body");

  for (let m = 0; m < 12; m++) {
    const diffArea = areaMonthly[m] - planArea[m];

    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td style="text-align:center;">${m + 1}月</td>

      <td>${Number(planArea[m].toFixed(2)).toLocaleString("ja-JP")}</td>
      <td>${Number(areaMonthly[m].toFixed(2)).toLocaleString("ja-JP")}</td>
      <td class="${diffArea > 0 ? "diff-positive" : diffArea < 0 ? "diff-negative" : "diff-zero"}">
        ${diffArea > 0 ? "+" : ""}${Number(diffArea.toFixed(2)).toLocaleString("ja-JP")}
      </td>

      <td>${Math.round(targets.targetKg[m]).toLocaleString("ja-JP")}</td>
      <td>${Math.round(actuals.kg[m]).toLocaleString("ja-JP")}</td>
      <td>${Math.round(targets.targetUnits[m]).toLocaleString("ja-JP")}</td>
      <td>${Math.round(actuals.units[m]).toLocaleString("ja-JP")}</td>
    `;

    tbody.appendChild(tr);
  }

  document.getElementById("loading").style.display = "none";
  document.getElementById("kpi-table").style.display = "table";
}

// ------------------------------
// 7. メイン処理
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

  weightRows.forEach(row => {
    const m = new Date(row.shippingDate).getMonth();
    actuals.kg[m] += Number(row.totalWeight || 0);
    actuals.units[m] += Number(row.bins || 0);
  });

  const refDatas = await Promise.all(
    plantingList.map(item => {
      const path = `logs/summary/${item.field}/${item.year}/${item.file}`;
      return loadPlantingRef(path);
    })
  );

  for (let i = 0; i < plantingList.length; i++) {
    const item = plantingList[i];
    const refData = refDatas[i];

    const area = calcAreaTan(refData.planting);

    const w = weightMap[item.plantingRef];
    if (!w) {
      logError("❌ plantingRef が CSV 側に存在しない（正規化後）:", item.plantingRef);
      continue;
    }

    const ym = refData.planting.harvestPlanYM;
    if (ym) {
      const planMonth = Number(ym.split("-")[1]) - 1;
      planArea[planMonth] += area;
    }

    for (let m = 0; m < 12; m++) {
      const ratio = w.monthlyKg[m] / w.totalKg;
      areaMonthly[m] += area * ratio;
    }
  }

  const targets = calcTargets(planArea, harvestBase);

  renderTable(planArea, areaMonthly, actuals, targets);
}

main();