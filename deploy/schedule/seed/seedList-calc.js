// seedList-calc.js

// 定植予定日 = 播種日 + 日数
export function calcPlanPlantDate(sowDate, days) {
  if (!sowDate || !days) return "";
  const d = new Date(sowDate);
  if (isNaN(d)) return "";
  d.setDate(d.getDate() + Number(days));
  return d.toISOString().slice(0, 10);
}

// 計算面積（反）
// trayCount × trayType × spacingRow × spacingBed
export function calcAreaFromTray(trayCount, trayType, spacingRow = 30, spacingBed = 120) {
  if (!trayCount || !trayType) return "";
  const plants = trayCount * trayType;
  const m2 = plants * (spacingRow / 100) * (spacingBed / 100);
  const tan = m2 / 990;
  return tan.toFixed(2);
}

// ★ 収穫予定（YYYY-MM）安全版
export function resolveHarvestYM(planPlantDate, planSowDate, harvestMonth) {
  if (!harvestMonth) return "";
  const base = planPlantDate || planSowDate;
  if (!base) return "";

  const d = new Date(base);
  if (isNaN(d)) return "";

  const y = d.getFullYear();
  const m = Number(harvestMonth);
  if (!m || m < 1 || m > 12) return "";

  const harvestY = (m < (d.getMonth() + 1)) ? y + 1 : y;

  return `${harvestY}-${String(m).padStart(2, "0")}`;
}
