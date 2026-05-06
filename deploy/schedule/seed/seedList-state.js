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
    planArea: "",
    daysToPlantRaw: "",
    daysToPlant: 0,
    planPlantDate: "",
    harvestPlanYM: "",
    source: ""
  };
}

/* ============================================================
   annual.json の STEP2 → seedList 初期行生成（収穫予定も自動計算）
============================================================ */
export async function setSeedRowsFromAnnual(step2rows) {
  rows = step2rows.map(r => {
    const planSowDate = r.sowDate || "";
    const planPlantDate = r.plantDate || "";
    const harvestMonth = r.month.split("-")[1]; // "11" など

    return {
      planSowDate,
      variety: r.variety,
      trayCountRaw: "",
      trayCount: 0,
      trayType: "",
      planArea: r.needArea || "",
      daysToPlantRaw: "",
      daysToPlant: 0,
      planPlantDate,
      harvestPlanYM: resolveHarvestYM(planPlantDate, planSowDate, harvestMonth),
      source: `STEP2:${r.harvestWeek}`
    };
  });
}
