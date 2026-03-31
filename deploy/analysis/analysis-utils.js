// analysis/analysis-utils.js

/* ===============================
   面積関連
=============================== */
export function calcAreaM2(quantity, rowCm, bedCm) {
  return quantity * (rowCm / 100) * (bedCm / 100);
}

export function calcAreaTan(areaM2) {
  return areaM2 / 990;
}

/* ===============================
   指標計算
=============================== */
export function calcYieldPerTan(totalWeight, areaTan) {
  return areaTan > 0 ? (totalWeight / areaTan).toFixed(1) : "—";
}

export function calcUnitsPerTan(totalAmount, areaTan) {
  return areaTan > 0 ? (totalAmount / areaTan).toFixed(1) : "—";
}

export function calcAvgWeight(totalWeight, totalAmount) {
  return totalAmount > 0 ? (totalWeight / totalAmount).toFixed(2) : "—";
}

export function calcDaysToHarvest(plantDate, firstHarvestDate) {
  if (!plantDate || !firstHarvestDate) return "—";
  const d1 = new Date(plantDate);
  const d2 = new Date(firstHarvestDate);
  return Math.floor((d2 - d1) / (1000 * 60 * 60 * 24));
}

/* ===============================
   育苗概要
   seedRef = "YYYYMMDD-品名-ロット"
=============================== */
export function getSeedlingSummary(seedRef, plantingDate) {
  if (!seedRef) {
    return { sowDate: "—", days: "—" };
  }

  // 播種日（seedRef の先頭8桁）
  const sowDateRaw = seedRef.slice(0, 8); // "20250712"
  const sowDate = `${sowDateRaw.slice(0,4)}-${sowDateRaw.slice(4,6)}-${sowDateRaw.slice(6,8)}`;

  // 育苗期間（日数）
  let days = "—";
  if (plantingDate) {
    const d1 = new Date(sowDate);
    const d2 = new Date(plantingDate);
    days = Math.floor((d2 - d1) / (1000 * 60 * 60 * 24));
  }

  return {
    sowDate, // "2025-07-12"
    days     // 例: 33
  };
}