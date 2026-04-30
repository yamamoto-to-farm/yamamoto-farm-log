// schedule/seed/seedList-calc.js

import { calcAreaM2, calcAreaTan } from "/analysis/analysis-utils.js";
import { getRows } from "./seedList-state.js";

export function calcAreaFromTray(trayCount, trayType) {
  if (!trayCount || !trayType) return "";

  const holes = trayType === "128" ? 128 : 200;
  const seedCount = trayCount * holes;

  const spacingRow = 34;
  const spacingBed = 60;

  const areaM2 = calcAreaM2(seedCount, spacingRow, spacingBed);
  const areaTan = calcAreaTan(areaM2);

  return areaTan.toFixed(2);
}

export function calcPlanPlantDate(planSowDate, days) {
  if (!planSowDate || !days) return "";
  const d = new Date(planSowDate);
  d.setDate(d.getDate() + Number(days));
  return d.toISOString().slice(0, 10);
}

export function resolveHarvestYM(planPlantDate, planSowDate, mm) {
  const today = new Date();
  const fallbackYear = today.getFullYear();

  const base = planPlantDate || planSowDate;
  if (!base) return `${fallbackYear}-${mm}`;

  const y = Number(base.slice(0, 4));
  const plantMonth = Number(base.slice(5, 7));
  const harvestMonth = Number(mm);

  const harvestYear = harvestMonth < plantMonth ? y + 1 : y;

  return `${harvestYear}-${mm}`;
}

export function calcNurseryStockTimeline() {
  const rows = getRows();
  const events = [];

  rows.forEach(r => {
    if (r.trayCount > 0) {
      if (r.planSowDate) events.push({ date: r.planSowDate, change: r.trayCount });
      if (r.planPlantDate) events.push({ date: r.planPlantDate, change: -r.trayCount });
    }
  });

  events.sort((a, b) => a.date.localeCompare(b.date));

  let current = 0;
  let maxStock = 0;

  events.forEach(ev => {
    current += ev.change;
    if (current > maxStock) maxStock = current;
  });

  return { maxStock };
}

export function renderSummary() {
  const cap = Number(document.getElementById("nurseryCapacity").value) || 0;
  const { maxStock } = calcNurseryStockTimeline();

  let html = `
    <div>最大在庫：${maxStock} 枚</div>
    <div>育苗ハウス容量：${cap} 枚</div>
  `;

  if (maxStock > cap) {
    html += `<div style="color:red;font-weight:bold;margin-top:6px;">
      NG（${maxStock - cap} 枚オーバー）
    </div>`;
  } else {
    html += `<div style="color:green;font-weight:bold;margin-top:6px;">
      OK（残り ${cap - maxStock} 枚）
    </div>`;
  }

  document.getElementById("summaryArea").innerHTML = html;
}
