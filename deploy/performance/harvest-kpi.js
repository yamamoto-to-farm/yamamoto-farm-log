// harvest-kpi.js
// KPI 年度ページ（CSV 直接集計版 / shippingDate ベース / month-kpi と完全一致）
// v1.3 - summary-index.json キャッシュ化 + findSummaryPath の逆引きマップ最適化
// さらに renderKpiPage は filters が未指定の場合に「今年のみ」をデフォルト適用

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
   summary-index.json キャッシュ & 逆引きマップ
   - ページ内で一度だけ読み込む
   - ref -> path のマップを作って高速検索
--------------------------------------------------------- */
let _summaryIndexCache = null;
let _summaryRefMap = null;

function parseYearFromDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.getFullYear();
}

/**
 * summary-index.json を読み込み、ref -> path の逆引きマップを作る
 */
async function _ensureSummaryIndex() {
  if (_summaryRefMap) return;

  // 読み込み
  _summaryIndexCache = await loadJSON("/data/summary-index.json");
  _summaryRefMap = {};

  // index の構造: { fld: { year: [file.json, ...], ... }, ... }
  for (const fld in _summaryIndexCache) {
    for (const y in _summaryIndexCache[fld]) {
      for (const f of _summaryIndexCache[fld][y]) {
        const fRef = safeFileName(f.replace(".json", ""));
        // 先に見つかったものを優先（通常は一意）
        if (!_summaryRefMap[fRef]) {
          _summaryRefMap[fRef] = `/logs/summary/${fld}/${y}/${f}`;
        }
      }
    }
  }
}

/**
 * findSummaryPath(ref)
 * - ref は normalizedRef（safeFileName された値）を想定
 * - summary-index.json を一度だけ読み込み、逆引きマップから高速に返す
 */
async function findSummaryPath(ref) {
  await _ensureSummaryIndex();
  return _summaryRefMap[ref] || null;
}

/* ---------------------------------------------------------
   KPI ページ描画（shippingDate ベース）
   - filters が null の場合は「今年のみ」をデフォルト適用
--------------------------------------------------------- */
export async function renderKpiPage(filters = null) {
  const plantingRows = normalizeKeys(await loadCSV("/logs/planting/all.csv"));
  const weightRows = normalizeKeys(await loadCSV("/logs/weight/all.csv"));
  const harvestBase = await loadJSON("/data/harvestBase.json");

  // shippingDate の年から年度一覧を作る（月次と完全一致)
  let years = [...new Set(
    weightRows
      .map(r => parseYearFromDate(r.shippingDate))
      .filter(Number.isInteger)
  )].sort();

  // デフォルトフィルタ: 指定がなければ今年のみを描画
  const currentYear = new Date().getFullYear();
  const f = filters || {};
  if (!Array.isArray(f.years) || f.years.length === 0) {
    if (years.includes(currentYear)) {
      f.years = [String(currentYear)];
    } else if (years.length > 0) {
      f.years = [String(years[years.length - 1])];
    } else {
      f.years = [];
    }
  }

  if (Array.isArray(f.years) && f.years.length > 0) {
    years = years.filter(y => f.years.includes(String(y)));
  }

  const container = document.getElementById("kpi-container");
  if (!container) return;

  container.innerHTML = years.map(y => renderYearBlock(y)).join("");

  for (const year of years) {
    const yearContainer = document.getElementById(`kpi-${year}`);
    if (!yearContainer) continue;

    const refsInYear = weightRows
      .filter(r => {
        const yearValue = parseYearFromDate(r.shippingDate);
        return yearValue === year;
      })
      .map(r => safeFileName(r.plantingRef))
      .filter(Boolean);

    const uniqueRefs = [...new Set(refsInYear)];

    let refList = uniqueRefs.map(ref => {
      const row = plantingRows.find(p =>
        safeFileName(p.plantingRef) === ref
      );
      return {
        plantingRef: row?.plantingRef || ref,
        normalizedRef: ref,
        variety: row?.variety || "-",
        harvestPlanYM: row?.harvestPlanYM || null
      };
    });

    if (Array.isArray(f.varieties) && f.varieties.length > 0) {
      refList = refList.filter(r => f.varieties.includes(r.variety));
    }

    yearContainer.innerHTML = await renderKpiForYear(year, refList, plantingRows, weightRows, harvestBase);
  }
}

/* ---------------------------------------------------------
   年ごとの KPI 生成（shippingDate ベース）
--------------------------------------------------------- */
async function renderKpiForYear(year, refList, plantingRows, weightRows, harvestBase) {
  const filteredWeightRows = weightRows.filter(row => {
    const rowYear = parseYearFromDate(row.shippingDate);
    return rowYear === year;
  });

  const weightMap = groupWeightByRef(filteredWeightRows, (ref) =>
    safeFileName(ref)
  );

  /* ------------------------------
     予定面積（CSV ベース）
     ※ refList に含まれる ref のみ
     ※ harvestPlanYM の「年」も一致したものだけ使う
  ------------------------------ */
  const planArea = Array(12).fill(0);

  plantingRows.forEach(row => {
    const ref = safeFileName(row.plantingRef);
    if (!refList.some(r => r.normalizedRef === ref)) return;

    const ym = row.harvestPlanYM;
    if (!ym) return;

    const [yStr, mStr] = ym.split("-");
    const y = Number(yStr);
    const m = Number(mStr) - 1;

    // ★ KPI の対象年と一致しない場合はスキップ
    if (y !== year) return;

    const area = calcAreaTanFromPlantingRow(row);
    planArea[m] += area;
  });


  /* ------------------------------
     実績（kg / 基）
     ※ month-kpi と完全一致
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
     summary.json 読み込み（refList に含まれるもののみ）
     - findSummaryPath はキャッシュ化済みで高速
  ------------------------------ */
  const summaryMap = {};

  // 並列で path を解決して読み込む（存在しないものはスキップ）
  await _ensureSummaryIndex();

  const loadPromises = refList.map(async (item) => {
    const ref = item.normalizedRef;
    const path = await findSummaryPath(ref);
    if (!path) return;
    try {
      summaryMap[ref] = await loadJSON(path);
    } catch (err) {
      // 読み込み失敗は無視して続行（ログが必要なら外部で出す）
      console.warn(`summary.json load failed for ${path}:`, err);
    }
  });

  await Promise.all(loadPromises);

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
  // フィルタ適用時はキャッシュを再利用するが、必要なら強制再読み込みオプションを受け付ける
  const detail = e.detail || {};
  if (detail.forceRefreshSummaryIndex) {
    // キャッシュをクリアして次回の検索で再読み込みさせる
    _summaryIndexCache = null;
    _summaryRefMap = null;
  }
  renderKpiPage(detail);
});
