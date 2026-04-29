// harvest-kpi.js
// KPI 年度ページ（CSV 直接集計版 / フィルタ対応 / year-index 廃止）
// ※ month-kpi と出荷数量（kg / 基数）の計算ロジックを完全一致させた版

import { loadCSV, normalizeKeys } from "/common/csv.js";
import { loadJSON } from "/common/json.js";
import { safeFileName } from "/common/utils.js?v=1.1";
import { renderYearBlock, renderKpiTable } from "./kpi-render.js";
import {
  calcAreaTanFromPlantingRow,
  groupWeightByRef,
  calcTargets,
  calcHarvestAreaMonthly
} from "./kpi-utils.js";

/* ---------------------------------------------------------
   summary-index.json から summary.json の場所を探す
   （month-kpi と同じく safeFileName のみで判定）
--------------------------------------------------------- */
async function findSummaryPath(ref) {
  const index = await loadJSON("/data/summary-index.json");

  for (const fld in index) {
    for (const y in index[fld]) {
      for (const f of index[fld][y]) {
        const fRef = safeFileName(f.replace(".json", ""));
        if (fRef === ref) {
          return `/logs/summary/${fld}/${y}/${f}`;
        }
      }
    }
  }
  return null;
}

/* ---------------------------------------------------------
   KPI ページ描画（フィルタ対応）
--------------------------------------------------------- */
export async function renderKpiPage(filters = null) {
  const plantingRows = normalizeKeys(await loadCSV("/logs/planting/all.csv"));

  // harvestPlanYM から年度一覧を作る
  let years = [...new Set(
    plantingRows
      .map(r => r.harvestPlanYM)
      .filter(Boolean)
      .map(ym => Number(ym.split("-")[0]))
  )].sort();

  const f = filters || {};

  // 年フィルタ
  if (Array.isArray(f.years) && f.years.length > 0) {
    years = years.filter(y => f.years.includes(String(y)));
  }

  // <details> を描画
  document.getElementById("kpi-container").innerHTML =
    years.map(y => renderYearBlock(y)).join("");

  // 各年の KPI を描画
  for (const year of years) {
    const container = document.getElementById(`kpi-${year}`);
    if (!container) continue;

    // refList（CSV ベース）
    let refList = plantingRows
      .filter(r => Number(r.harvestPlanYM?.split("-")[0]) === year)
      .map(r => ({
        plantingRef: r.plantingRef,
        // ★ month-kpi と同じく safeFileName のみで正規化
        normalizedRef: safeFileName(r.plantingRef),
        variety: r.variety,
        harvestPlanYM: r.harvestPlanYM
      }));

    // 品種フィルタ
    if (Array.isArray(f.varieties) && f.varieties.length > 0) {
      refList = refList.filter(r => f.varieties.includes(r.variety));
    }

    container.innerHTML = await renderKpiForYear(year, refList);
  }
}

/* ---------------------------------------------------------
   年ごとの KPI 生成（CSV 直接集計）
--------------------------------------------------------- */
async function renderKpiForYear(year, refList) {
  const plantingRows = normalizeKeys(await loadCSV("/logs/planting/all.csv"));
  const weightRows = normalizeKeys(await loadCSV("/logs/weight/all.csv"));

  /* ------------------------------
     実績（weight → ref ごと）
     ※ month-kpi と同じく safeFileName のみで集計
  ------------------------------ */
  const filteredWeightRows = weightRows.filter(row => {
    const d = new Date(row.shippingDate);
    return d.getFullYear() === year;
  });

  const weightMap = groupWeightByRef(filteredWeightRows, (ref) =>
    safeFileName(ref)
  );

  /* ------------------------------
     予定面積（CSV ベース）
  ------------------------------ */
  const planArea = Array(12).fill(0);

  plantingRows.forEach(row => {
    const ym = row.harvestPlanYM;
    if (!ym) return;

    const planYear = Number(ym.split("-")[0]);
    if (planYear !== year) return;

    const month = Number(ym.split("-")[1]) - 1;
    const area = calcAreaTanFromPlantingRow(row);

    const ref = safeFileName(row.plantingRef);
    if (refList.some(r => r.normalizedRef === ref)) {
      planArea[month] += area;
    }
  });

  /* ------------------------------
     実績（kg / 基）
     ※ month-kpi と完全同一ロジック
  ------------------------------ */
  const actuals = { kg: Array(12).fill(0), units: Array(12).fill(0) };

  filteredWeightRows.forEach(row => {
    const ref = safeFileName(row.plantingRef);
    if (!refList.some(r => r.normalizedRef === ref)) return;

    const d = new Date(row.shippingDate);
    const m = d.getMonth();
    actuals.kg[m] += Number(row.totalWeight || 0);
    actuals.units[m] += Number(row.bins || 0);
  });

  /* ------------------------------
     summary.json 読み込み
  ------------------------------ */
  const summaryMap = {};

  for (const item of refList) {
    const ref = item.normalizedRef;
    const path = await findSummaryPath(ref);
    if (!path) continue;

    summaryMap[ref] = await loadJSON(path);
  }

  /* ------------------------------
     収穫面積（A方式）
  ------------------------------ */
  const areaMonthly = calcHarvestAreaMonthly(
    refList.map(r => ({ ...r, plantingRef: r.normalizedRef })),
    summaryMap,
    weightMap
  );

  /* ------------------------------
     目標値
  ------------------------------ */
  const harvestBase = await loadJSON("/data/harvestBase.json");
  const targets = calcTargets(planArea, harvestBase);

  /* ------------------------------
     KPI テーブル生成
  ------------------------------ */
  return renderKpiTable(planArea, areaMonthly, actuals, targets, year);
}

/* ---------------------------------------------------------
   フィルタイベント
--------------------------------------------------------- */
window.addEventListener("kpi-filter:apply", (e) => {
  renderKpiPage(e.detail);
});
