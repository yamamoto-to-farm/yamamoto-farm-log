// kpi-utils.js
// 面積計算・集計ロジック・目標値計算

export function calcAreaTanFromPlantingRow(row) {
  const qty = Number(row.quantity || 0);
  const rowSpace = Number(row.spacingRow || row["spacing.row"] || 0);
  const bedSpace = Number(row.spacingBed || row["spacing.bed"] || 0);
  return (qty * rowSpace * bedSpace) / 10000000;
}

export function calcAreaTanFromSummaryPlanting(planting) {
  const qty = Number(planting.quantity || 0);
  const rowSpace = Number(planting.spacing?.row || 0);
  const bedSpace = Number(planting.spacing?.bed || 0);
  return (qty * rowSpace * bedSpace) / 10000000;
}

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
