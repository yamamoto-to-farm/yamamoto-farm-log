// schedule/seed/seedList-state.js

import { loadJSON } from "/common/json.js";

let rows = [];
let varietyData = [];

export function getRows() {
  return rows;
}

export function getVarietyData() {
  return varietyData;
}

export async function initRows() {
  varietyData = await loadJSON("/data/varieties.json");

  for (let i = 0; i < 12; i++) {
    rows.push(makeEmptyRow());
  }
}

export function makeEmptyRow() {
  return {
    planSowDate: "",
    variety: "",
    cropType: "",
    trayCountRaw: "",
    trayCount: 0,
    trayType: "",
    planArea: "",
    daysToPlantRaw: "",
    daysToPlant: 0,
    planPlantDate: "",
    harvestPlanYM: ""
  };
}
