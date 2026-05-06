// seedList-state.js

import { resolveHarvestYM } from "./seedList-calc.js";

let rows = [];

/* ============================================================
   行データ管理
============================================================ */
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
   ★ 品種データ取得（A方式：ここに追加）
   varieties.json を読み込んで返す
============================================================ */
export async function getVarietyData() {
  const res = await fetch("/data/varieties.json");
  if (!res.ok) {
    console.error("varieties.json の読み込みに失敗:", res.status);
    return [];
  }
  return await res.json();
}

/* ============================================================
   annual.json の STEP2 → seedList 初期行生成
   （収穫予定も自動計算）
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
