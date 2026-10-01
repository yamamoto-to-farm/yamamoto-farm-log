// harvest-kpi.js
// KPI 年度ページ（予定は定植CSV、実績はshippingDateベース）
// v1.3 - summary-index.json キャッシュ化 + findSummaryPath の逆引きマップ最適化
// さらに renderKpiPage は filters が未指定の場合に「今年のみ」をデフォルト適用

import { loadCSV, normalizeKeys } from "/common/csv.js";
import { loadJSON } from "/common/json.js";
import { safeFileName, printInline } from "/common/utils.js?v=20260930-1";
import { showPlantingDetailModal } from "/common/planting-detail.js?v=20260930-1";
import { showInfoModal } from "/common/showInfoModal.js?v=1";
import { renderYearBlock, renderKpiTable } from "./kpi-render.js?v=20260930-1";
import {
  calcAreaTanFromPlantingRow,
  groupWeightByRef,
  calcTargets,
  calcHarvestAreaMonthly
} from "./kpi-utils.js?v=20261001-1";

/* ---------------------------------------------------------
   summary-index.json キャッシュ & 逆引きマップ
   - ページ内で一度だけ読み込む
   - ref -> path のマップを作って高速検索
--------------------------------------------------------- */
let _summaryIndexCache = null;
let _summaryRefMap = null;

function buildAnnualStep1MonthlyData(calendarYear, annualAll) {
  const planArea = Array(12).fill(null);
  const targetKg = Array(12).fill(null);
  const targetUnits = Array(12).fill(null);
  const candidateYears = [calendarYear - 1, calendarYear];

  for (const planYear of candidateYears) {
    const months = annualAll?.[String(planYear)]?.step1?.months;
    if (!Array.isArray(months)) continue;

    for (const item of months) {
      const ym = String(item?.month || "").trim();
      const match = ym.match(/^(\d{4})-(\d{2})$/);
      if (!match) continue;

      const targetYear = Number(match[1]);
      const monthIndex = Number(match[2]) - 1;
      if (targetYear !== calendarYear || monthIndex < 0 || monthIndex > 11) continue;

      const needArea = Number(item?.needArea || 0);
      const yieldPer10a = Number(item?.yieldPer10a || 0);
      const units = Number(item?.targetUnits || 0);

      planArea[monthIndex] = needArea;
      targetKg[monthIndex] = needArea * yieldPer10a;
      targetUnits[monthIndex] = units;
    }
  }

  return { planArea, targetKg, targetUnits };
}

function mergeAnnualStep1IntoTargets(fallbackTargets, annualData) {
  const goalArea = (annualData?.planArea || Array(12).fill(null))
    .map(value => value === null || value === undefined ? null : Number(value || 0));
  const nextTargets = {
    targetKg: [...(fallbackTargets?.targetKg || Array(12).fill(0))],
    targetUnits: [...(fallbackTargets?.targetUnits || Array(12).fill(0))]
  };
  const planSources = Array(12).fill("csv");

  for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
    if (annualData?.planArea?.[monthIndex] === null || annualData?.planArea?.[monthIndex] === undefined) continue;

    nextTargets.targetKg[monthIndex] = Number(annualData.targetKg?.[monthIndex] || 0);
    nextTargets.targetUnits[monthIndex] = Number(annualData.targetUnits?.[monthIndex] || 0);
    planSources[monthIndex] = "annual";
  }

  return { goalArea, targets: nextTargets, planSources };
}

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
  const seedRows = normalizeKeys(await loadCSV("/logs/seed/all.csv").catch(() => []));
  const weightRows = normalizeKeys(await loadCSV("/logs/weight/all.csv"));
  const harvestBase = await loadJSON("/data/harvestBase.json");
  const annualAll = await loadJSON("/logs/schedule/annual/annual.json").catch(() => ({}));

  // 予定対象年と実績対象年の和集合を年フィルターに使う。
  let years = [...new Set(
    [
      ...plantingRows
        .map(row => String(row.harvestPlanYM || "").match(/^(\d{4})-\d{2}$/)?.[1])
        .filter(Boolean)
        .map(Number),
      ...weightRows
        .map(r => parseYearFromDate(r.shippingDate))
        .filter(Number.isInteger)
    ]
  )].sort((a, b) => a - b);

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

    const plannedRefsInYear = plantingRows
      .filter(row => String(row.harvestPlanYM || "").startsWith(`${year}-`))
      .map(row => safeFileName(row.plantingRef))
      .filter(Boolean);

    const uniqueRefs = [...new Set([...refsInYear, ...plannedRefsInYear])];

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

    yearContainer.innerHTML = await renderKpiForYear(year, refList, plantingRows, seedRows, weightRows, harvestBase, annualAll);

    yearContainer.querySelectorAll(".kpi-help-button").forEach(button => {
      button.addEventListener("click", () => showKpiColumnHelp(button.dataset.kpiHelp));
    });

    yearContainer.querySelectorAll(".plan-cell").forEach(cell => {
      if (cell.dataset.planSource === "annual") return;

      cell.addEventListener("click", () => {
        const yearValue = Number(cell.dataset.year);
        const month = Number(cell.dataset.month);
        openPlanRefModal(yearValue, month, refList, plantingRows, seedRows);
      });
    });
  }
}

function showKpiColumnHelp(key) {
  const descriptions = {
    month: ["月", "対象年の月です。月名のリンクをクリックすると、その月のロット別収穫・出荷明細ページへ移動します。"],
    "goal-area": ["目標面積(反)", "annual STEP1計画に登録された、その月の目標面積です。計画未設定の月は「—」を表示します。セル操作はありません。"],
    "planted-area": ["定植面積(反)", "定植記録の株数・株間・畝間から算出し、収穫予定月ごとに集計した面積です。数値セルをクリックすると、根拠となる定植記録・播種日・面積と合計を表示します。"],
    "harvest-area": ["収穫面積(反)", "出荷実績を作付けごとに定植面積へ按分し、その月に出荷があった作付けの面積を集計した値です。表示のみです。"],
    "area-diff": ["差分(反)", "収穫面積から定植面積を引いた値です。プラスは収穫面積が定植面積を上回り、マイナスはまだ収穫面積に計上されていない定植面積があることを示します。表示のみです。"],
    "target-kg": ["目標収量(kg)", "annual STEP1計画の目標面積と月別基準収量から算出した目標収量です。annualの設定値を優先します。表示のみです。"],
    "actual-kg": ["収穫実績(kg)", "対象月に記録された出荷重量の合計です。出荷日を基準に集計します。表示のみです。"],
    "target-units": ["出荷目標(基)", "annual STEP1計画に登録された月別の出荷目標です。annualの設定値を優先します。表示のみです。"],
    "actual-units": ["出荷実績(基)", "対象月に記録された出荷基数の合計です。出荷日を基準に集計します。"]
  };
  const [title, description] = descriptions[key] || ["KPI列の説明", "説明がありません。"];
  showInfoModal(title, `<p>${description}</p>`);
}

/* ---------------------------------------------------------
   年ごとの KPI 生成（shippingDate ベース）
--------------------------------------------------------- */
async function renderKpiForYear(year, refList, plantingRows, seedRows, weightRows, harvestBase, annualAll) {
  const filteredWeightRows = weightRows.filter(row => {
    const rowYear = parseYearFromDate(row.shippingDate);
    return rowYear === year;
  });

  const weightMap = groupWeightByRef(filteredWeightRows, (ref) =>
    safeFileName(ref)
  );

  /* ------------------------------
    定植面積（定植CSVベース）
    出荷実績の有無にかかわらず、対象年の全予定作付けを集計する。
  ------------------------------ */
  const planArea = Array(12).fill(0);

  plantingRows.forEach(row => {
    if (refList.length && !refList.some(ref => ref.variety === row.variety)) return;

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
  const fallbackTargets = calcTargets(planArea, harvestBase);
  const annualData = buildAnnualStep1MonthlyData(year, annualAll);
  const mergedPlan = mergeAnnualStep1IntoTargets(fallbackTargets, annualData);

  /* ------------------------------
     KPI テーブル生成
  ------------------------------ */
  return renderKpiTable(mergedPlan.goalArea, planArea, areaMonthly, actuals, mergedPlan.targets, year, mergedPlan.planSources);
}

function openPlanRefModal(year, month, refList, plantingRows, seedRows) {
  const ym = `${year}-${String(month + 1).padStart(2, "0")}`;
  const allowedVarieties = new Set(refList.map(item => item.variety).filter(Boolean));
  const rows = plantingRows
    .filter(row => row.harvestPlanYM === ym)
    .filter(row => !allowedVarieties.size || allowedVarieties.has(row.variety))
    .map(row => {
      const seedRefs = String(row.seedRef || "").split(/[\/,]/).map(ref => ref.trim()).filter(Boolean);
      const seedDates = [...new Set(seedRefs
        .map(ref => seedRows.find(seed => String(seed.seedRef || "").replace(/\s+/g, "") === ref.replace(/\s+/g, ""))?.seedDate)
        .filter(Boolean))];
      return { ...row, seedDates, areaTan: calcAreaTanFromPlantingRow(row) };
    });
  const totalArea = rows.reduce((sum, row) => sum + row.areaTan, 0);

  const container = document.getElementById("modal-container");
  container.style.display = "block";

  container.innerHTML = `
    <div class="modal-bg" id="modal-bg">
      <div class="modal kpi-planting-modal">
        <div class="modal-close" id="modal-close">×</div>
        <div id="kpi-planting-print-root">
          <h3>${ym} 収穫予定の定植記録（${rows.length} 件）</h3>

        ${rows.length ? `
          <div class="kpi-planting-modal-content">
            <table class="kpi-planting-table" style="margin-top:12px;">
              <thead>
                <tr>
                  <th>定植日</th>
                  <th>圃場</th>
                  <th>品種</th>
                  <th>播種日</th>
                  <th>株数</th>
                  <th>面積(反)</th>
                </tr>
              </thead>
              <tbody>
                ${rows.map(row => `
                  <tr>
                    <td><span role="button" tabindex="0" class="kpi-planting-date" data-planting-ref="${escapeHtml(row.plantingRef || "")}">${escapeHtml(row.plantDate || "-")}</span></td>
                    <td><a href="/fields/index.html?field=${encodeURIComponent(row.field || "")}">${escapeHtml(row.field || "-")}</a></td>
                    <td><a href="/varieties/index.html?variety=${encodeURIComponent(row.variety || "")}">${escapeHtml(row.variety || "-")}</a></td>
                    <td>${row.seedDates.length ? row.seedDates.map(escapeHtml).join("<br>") : "-"}</td>
                    <td>${Number(row.quantity || 0).toLocaleString()}</td>
                    <td>${row.areaTan.toFixed(2)}</td>
                  </tr>
                `).join("")}
              </tbody>
              <tfoot>
                <tr>
                  <th colspan="5" style="text-align:right;">合計</th>
                  <th>${totalArea.toFixed(2)}</th>
                </tr>
              </tfoot>
            </table>
          </div>
        ` : '<p class="info-line">該当する定植記録はありません。</p>'}
        </div>

        <div class="modal-footer">
          <button class="secondary-btn" id="print-planting-rows" type="button">印刷</button>
          <button class="secondary-btn" id="close-btn">閉じる</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById("modal-close").onclick = closeModal;
  document.getElementById("close-btn").onclick = closeModal;
  document.getElementById("print-planting-rows").onclick = () => {
    printInline("#kpi-planting-print-root", `${ym} 収穫予定の定植記録`);
  };
  document.getElementById("modal-bg").onclick = (e) => {
    if (e.target.classList.contains("modal-bg")) closeModal();
  };
  document.querySelectorAll(".kpi-planting-date").forEach(button => {
    const openDetail = () => showPlantingDetailModal(button.dataset.plantingRef, { canDiscard: window.currentRole === "admin" });
    button.addEventListener("click", openDetail);
    button.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openDetail();
      }
    });
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function closeModal() {
  const container = document.getElementById("modal-container");
  if (!container) return;
  container.innerHTML = "";
  container.style.display = "none";
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
