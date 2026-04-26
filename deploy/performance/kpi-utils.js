// kpi-utils.js
// 面積計算・集計ロジック・目標値計算（A方式：収穫量比率で面積按分）

/* ===============================
   面積（反）計算：planting/all.csv 用
=============================== */
export function calcAreaTanFromPlantingRow(row) {
  const qty = Number(row.quantity || 0);
  const rowSpace = Number(row.spacingRow || row["spacing.row"] || 0);
  const bedSpace = Number(row.spacingBed || row["spacing.bed"] || 0);
  return (qty * rowSpace * bedSpace) / 10000000;
}

/* ===============================
   面積（反）計算：summary.json 用
=============================== */
export function calcAreaTanFromSummaryPlanting(planting) {
  const qty = Number(planting.quantity || 0);
  const rowSpace = Number(planting.spacing?.row || 0);
  const bedSpace = Number(planting.spacing?.bed || 0);
  return (qty * rowSpace * bedSpace) / 10000000;
}

/* ===============================
   weight CSV → plantingRef 集計
=============================== */
export function groupWeightByRef(weightRows, safeFileName) {
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

    const d = new Date(row.shippingDate);
    const m = d.getMonth();
    const kg = Number(row.totalWeight || 0);
    const units = Number(row.bins || 0);

    map[ref].monthlyKg[m] += kg;
    map[ref].monthlyUnits[m] += units;
    map[ref].totalKg += kg;
  });

  return map;
}

/* ===============================
   A方式：収穫量比率で面積を按分する
=============================== */
export function calcHarvestAreaMonthly(plantingList, summaryMap, weightMap) {
  const areaMonthly = Array(12).fill(0);

  for (const item of plantingList) {
    const ref = item.plantingRef;
    const summary = summaryMap[ref];
    const w = weightMap[ref];

    if (!summary || !w || w.totalKg <= 0) continue;

    // 作付面積（反）
    const area = calcAreaTanFromSummaryPlanting(summary.planting);

    // 月別収穫量比率で按分
    for (let m = 0; m < 12; m++) {
      const ratio = w.monthlyKg[m] / w.totalKg;
      areaMonthly[m] += area * ratio;
    }
  }

  return areaMonthly;
}

/* ===============================
   目標値（予定面積 × 基準値）
=============================== */
export function calcTargets(planArea, harvestBase) {
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
