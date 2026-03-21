// harvest-kpi.js（年ごと自動展開版）

import { loadJSON } from "/yamamoto-farm-log/common/json.js?v=1.1";
import { loadCSV } from "/yamamoto-farm-log/common/csv.js?v=1.1";
import { safeFileName } from "/yamamoto-farm-log/common/utils.js?v=1.1";

const DEBUG = true;
const log = (...a) => DEBUG && console.log(...a);
const logError = (...a) => DEBUG && console.error(...a);

/* ===============================
   1. 年一覧を自動抽出
=============================== */
async function getYearList() {
  const index = await loadJSON("data/summary-index.json");
  const years = new Set();

  for (const field in index) {
    for (const year in index[field]) {
      years.add(Number(year));
    }
  }

  return [...years].sort();
}

/* ===============================
   2. 年ごとの plantingRef 一覧
=============================== */
async function loadPlantingRefsForYear(targetYear) {
  const index = await loadJSON("data/summary-index.json");
  const list = [];

  for (const field in index) {
    if (!index[field][targetYear]) continue;

    for (const file of index[field][targetYear]) {
      list.push({
        field,
        year: targetYear,
        file,
        plantingRef: safeFileName(file.replace(".json", ""))
      });
    }
  }

  return list;
}

/* ===============================
   3. 面積（反）計算
=============================== */
function calcAreaTan(planting) {
  const qty = Number(planting.quantity || 0);
  const row = Number(planting.spacing.row || 0);
  const bed = Number(planting.spacing.bed || 0);

  // cm² → m² → 反（1000m²）
  return (qty * row * bed) / 10000000;
}

/* ===============================
   4. CSV を plantingRef ごとに集計
=============================== */
function groupWeightByRef(weightRows) {
  const map = {};

  weightRows.forEach(row => {
    const ref = safeFileName(row.plantingRef);
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

/* ===============================
   5. 目標値（予定面積 × 基準値）
=============================== */
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

/* ===============================
   6. KPI テーブル HTML 生成
=============================== */
function renderKpiTable(planArea, areaMonthly, actuals, targets) {
  let html = `
    <table class="kpi-table">
      <thead>
        <tr>
          <th>月</th>
          <th>予定面積(反)</th>
          <th>収穫面積(反)</th>
          <th>差分(反)</th>
          <th>目標収量(kg)</th>
          <th>収穫実績(kg)</th>
          <th>出荷目標(基)</th>
          <th>出荷実績(基)</th>
        </tr>
      </thead>
      <tbody>
  `;

  for (let m = 0; m < 12; m++) {
    const diff = areaMonthly[m] - planArea[m];

    html += `
      <tr>
        <td>${m + 1}月</td>
        <td>${Number(planArea[m].toFixed(2)).toLocaleString("ja-JP")}</td>
        <td>${Number(areaMonthly[m].toFixed(2)).toLocaleString("ja-JP")}</td>
        <td>${diff > 0 ? "+" : ""}${Number(diff.toFixed(2)).toLocaleString("ja-JP")}</td>
        <td>${Math.round(targets.targetKg[m]).toLocaleString("ja-JP")}</td>
        <td>${Math.round(actuals.kg[m]).toLocaleString("ja-JP")}</td>
        <td>${Math.round(targets.targetUnits[m]).toLocaleString("ja-JP")}</td>
        <td>${Math.round(actuals.units[m]).toLocaleString("ja-JP")}</td>
      </tr>
    `;
  }

  html += "</tbody></table>";
  return html;
}

/* ===============================
   7. 年ごとの KPI を生成
=============================== */
async function renderKpiForYear(year) {
  const harvestBase = await loadJSON("data/harvestBase.json");
  const plantingList = await loadPlantingRefsForYear(year);
  const weightRows = await loadCSV("logs/weight/all.csv");

  // 実績を年でフィルタ
  const filteredWeightRows = weightRows.filter(row => {
    return new Date(row.shippingDate).getFullYear() === year;
  });

  const weightMap = groupWeightByRef(filteredWeightRows);

  const planArea = Array(12).fill(0);
  const areaMonthly = Array(12).fill(0);
  const actuals = { kg: Array(12).fill(0), units: Array(12).fill(0) };

  // 実績集計
  filteredWeightRows.forEach(row => {
    const m = new Date(row.shippingDate).getMonth();
    actuals.kg[m] += Number(row.totalWeight || 0);
    actuals.units[m] += Number(row.bins || 0);
  });

  // plantingRef.json 読み込み
  const refDatas = await Promise.all(
    plantingList.map(item =>
      loadJSON(`logs/summary/${item.field}/${item.year}/${item.file}`)
    )
  );

  // 面積計算
  for (let i = 0; i < plantingList.length; i++) {
    const item = plantingList[i];
    const ref = refDatas[i];

    const area = calcAreaTan(ref.planting);
    const w = weightMap[item.plantingRef];

    // 予定面積
    const ym = ref.planting.harvestPlanYM;
    if (ym) {
      const planMonth = Number(ym.split("-")[1]) - 1;
      planArea[planMonth] += area;
    }

    // 実績面積（収穫月に割り振り）
    if (w && w.totalKg > 0) {
      for (let m = 0; m < 12; m++) {
        const ratio = w.monthlyKg[m] / w.totalKg;
        areaMonthly[m] += area * ratio;
      }
    }
  }

  const targets = calcTargets(planArea, harvestBase);
  return renderKpiTable(planArea, areaMonthly, actuals, targets);
}

/* ===============================
   8. 年ごとに <details> を生成して表示
=============================== */
export async function renderKpiPage() {
  const years = await getYearList();
  let html = "";

  for (const year of years) {
    html += `
      <details>
        <summary>${year} 年</summary>
        <div id="kpi-${year}" class="kpi-block">読み込み中...</div>
      </details>
    `;
  }

  document.getElementById("kpi-container").innerHTML = html;

  // 年ごとに KPI を描画
  for (const year of years) {
    const container = document.getElementById(`kpi-${year}`);
    container.innerHTML = await renderKpiForYear(year);
  }
}