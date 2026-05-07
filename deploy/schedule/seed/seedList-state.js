// seedList-state.js

import { resolveHarvestYM } from "./seedList-calc.js";

let rows = [];

export function getRows() {
  return rows;
}

/* ▼ ソート状態 */
export let sortKey = null;
export let sortOrder = "asc";

export function setSort(key) {
  if (sortKey === key) {
    sortOrder = sortOrder === "asc" ? "desc" : "asc";
  } else {
    sortKey = key;
    sortOrder = "asc";
  }
}

export function makeEmptyRow() {
  return {
    planSowDate: "",
    variety: "",
    trayCountRaw: "",
    trayCount: 0,
    trayType: "",
    planAreaPlan: "",
    planAreaCalc: "",
    spacingRow: 34,
    spacingBed: 60,
    daysToPlantRaw: "",
    daysToPlant: 0,
    planPlantDate: "",
    harvestMonth: "",
    harvestPlanYM: "",
    harvestWeek: "",
    source: "",
    memo: ""
  };
}

export async function getVarietyData() {
  const res = await fetch("/data/varieties.json");
  return await res.json();
}

export async function setSeedRowsFromAnnual(step2rows) {
  rows = step2rows.map(r => {
    const planSowDate = r.sowDate || "";
    const planPlantDate = r.plantDate || "";
    const harvestMonth = r.month.split("-")[1];

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
      spacingRow: 34,
      spacingBed: 60,
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
