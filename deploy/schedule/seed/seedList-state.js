// seedList-state.js

import { resolveHarvestYM } from "./seedList-calc.js";

let rows = [];

export function getRows() {
  return rows;
}

export function makeEmptyRow() {
  return {
    planSowDate: "",
    variety: "",
    trayCountRaw: "",
    trayCount: 0,
    trayType: "",
    planAreaPlan: "",     // 計画面積（STEP2）
    planAreaCalc: "",     // 計算面積
    spacingRow: 34,       // ★ 株間（デフォルト）
    spacingBed: 60,       // ★ 畝間（デフォルト）
    daysToPlantRaw: "",
    daysToPlant: 0,
    planPlantDate: "",
    harvestMonth: "",
    harvestPlanYM: "",
    harvestWeek: "",
    source: "",
    memo: ""              // ★ 備考
  };
}

// 品種データ
export async function getVarietyData() {
  const res = await fetch("/data/varieties.json");
  return await res.json();
}

// STEP2 → 初期行生成
export async function setSeedRowsFromAnnual(step2rows) {
  rows = step2rows.map(r => {
    const planSowDate = r.sowDate || "";
    const planPlantDate = r.plantDate || "";
    const harvestMonth = r.month.split("-")[1]; // "11"

    // 日数自動計算
    let daysToPlant = "";
    if (planSowDate && planPlantDate) {
      const d1 = new Date(planSowDate);
      const d2 = new Date(planPlantDate);
      daysToPlant = Math.round((d2 - d1) / 86400000);
    }

    return {
      planSowDate,
      variety: r.variety,
      trayCountRaw: "",
      trayCount: 0,
      trayType: "",
      planAreaPlan: r.needArea || "",
      planAreaCalc: "",
      spacingRow: 34,      // ★ デフォルト株間
      spacingBed: 60,      // ★ デフォルト畝間
      daysToPlantRaw: daysToPlant,
      daysToPlant,
      planPlantDate,
      harvestMonth,
      harvestPlanYM: resolveHarvestYM(planPlantDate, planSowDate, harvestMonth),
      harvestWeek: r.harvestWeek,
      source: "",
      memo: ""
    };
  });
}
