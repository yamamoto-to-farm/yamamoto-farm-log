// harvest-kpi.js（収穫年ベース・完全修正版）

import { loadJSON } from "/common/json.js?v=1.1";
import { loadCSV } from "/common/csv.js?v=1.1";
import { safeFileName } from "/common/utils.js?v=1.1";

const DEBUG = true;
const log = (...a) => DEBUG && console.log("[KPI]", ...a);
const logError = (...a) => DEBUG && console.error("[KPI-ERROR]", ...a);

/* ===============================
   1. 年一覧を「予定年＋実績年」から生成
=============================== */
async function getYearList() {
    log("年一覧取得開始");

    const index = await loadJSON("data/summary-index.json");
    const weightRows = await loadCSV("logs/weight/all.csv");

    const years = new Set();

    // ★ harvestPlanYM の年（予定年）
    for (const field in index) {
        for (const year in index[field]) {
            for (const file of index[field][year]) {
                const summary = await loadJSON(`logs/summary/${field}/${year}/${file}`);
                const planYear = Number(summary.planting.harvestPlanYM.split("-")[0]);
                years.add(planYear);
            }
        }
    }

    // ★ shippingDate の年（実績年）
    weightRows.forEach(row => {
        const y = new Date(row.shippingDate).getFullYear();
        years.add(y);
    });

    const list = [...years].sort();
    log("抽出された年一覧:", list);

    return list;
}

/* ===============================
   2. 予定年（harvestPlanYM）で plantingRef を抽出
=============================== */
async function loadPlantingRefsForYear(targetYear) {
    log(`年 ${targetYear} の plantingRef 抽出開始`);

    const index = await loadJSON("data/summary-index.json");
    const list = [];

    for (const field in index) {
        for (const year in index[field]) {
            for (const file of index[field][year]) {
                const summary = await loadJSON(`logs/summary/${field}/${year}/${file}`);
                const planYear = Number(summary.planting.harvestPlanYM.split("-")[0]);

                if (planYear === targetYear) {
                    list.push({
                        field,
                        year,
                        file,
                        plantingRef: safeFileName(file.replace(".json", ""))
                    });
                }
            }
        }
    }

    log(`年 ${targetYear} の plantingRef 一覧:`, list);
    return list;
}

/* ===============================
   3. 面積（反）計算
=============================== */
function calcAreaTan(planting) {
    const qty = Number(planting.quantity || 0);
    const row = Number(planting.spacing.row || 0);
    const bed = Number(planting.spacing.bed || 0);

    return (qty * row * bed) / 10000000;
}

/* ===============================
   4. CSV を plantingRef ごとに集計（shippingDate ベース）
=============================== */
function groupWeightByRef(weightRows) {
    log("CSV → plantingRef 集計開始");

    const map = {};

    weightRows.forEach(row => {
        const ref = safeFileName(row.plantingRef);
        if (!ref) return;

        if (!map[ref]) {
            map[ref] = {
                monthlyKg: Array(12).fill(0),
                monthlyUnits: Array(12).fill(0),
                totalKg: 0
            };
        }

        const d = new Date(row.shippingDate);
        const m = d.getMonth();
        const kg = Number(row.totalWeight || 0);
        const units = Number(row.bins || 0);

        map[ref].monthlyKg[m] += kg;
        map[ref].monthlyUnits[m] += units;
        map[ref].totalKg += kg;
    });

    log("CSV 集計結果:", map);
    return map;
}

/* ===============================
   5. 目標値（予定面積 × 基準値）
=============================== */
function calcTargets(planArea, harvestBase) {
    log("目標値計算開始");

    const targetKg = Array(12).fill(0);
    const targetUnits = Array(12).fill(0);

    for (let m = 0; m < 12; m++) {
        const key = String(m + 1).padStart(2, "0");
        const base = harvestBase.monthly[key];
        if (!base) continue;

        targetKg[m] = planArea[m] * Number(base.yieldPerTan || 0);
        targetUnits[m] = planArea[m] * Number(base.unitsPerTan || 0);
    }

    return { targetKg, targetUnits };
}

/* ===============================
   6. KPI テーブル HTML 生成（合計行つき）
=============================== */
function renderKpiTable(planArea, areaMonthly, actuals, targets, year) {
    log("KPI テーブル生成開始");

    let html = `
    <table class="kpi-table">
      <thead>
        <tr>
          <th>月</th>
          <th>予定面積(反)</th>
          <th>収穫面積(反)</th>
          <th>差分(反)</th>
          <th>目標収量(kg)</th>
          <th>収穫実績(kg)</th>
          <th>出荷目標(基)</th>
          <th>出荷実績(基)</th>
        </tr>
      </thead>
      <tbody>
  `;

    // --- 月別行 ---
    for (let m = 0; m < 12; m++) {
        const diff = areaMonthly[m] - planArea[m];
        const diffClass =
            diff > 0 ? "diff-positive" :
            diff < 0 ? "diff-negative" :
            "diff-zero";

        html += `
      <tr>
        <td>
          <a href="kpi-month.html?year=${year}&month=${m + 1}">
            ${m + 1}月
          </a>
        </td>
        <td>${planArea[m].toFixed(2)}</td>
        <td>${areaMonthly[m].toFixed(2)}</td>
        <td class="${diffClass}">
          ${diff > 0 ? "+" : ""}${diff.toFixed(2)}
        </td>
        <td>${Math.round(targets.targetKg[m]).toLocaleString("ja-JP")}</td>
        <td>${Math.round(actuals.kg[m]).toLocaleString("ja-JP")}</td>
        <td>${Math.round(targets.targetUnits[m]).toLocaleString("ja-JP")}</td>
        <td>${Math.round(actuals.units[m]).toLocaleString("ja-JP")}</td>
      </tr>
    `;
    }

    // --- 合計行（ループの外） ---
    const totalPlan = planArea.reduce((a, b) => a + b, 0);
    const totalArea = areaMonthly.reduce((a, b) => a + b, 0);
    const totalDiff = totalArea - totalPlan;

    const totalTargetKg = targets.targetKg.reduce((a, b) => a + b, 0);
    const totalActualKg = actuals.kg.reduce((a, b) => a + b, 0);

    const totalTargetUnits = targets.targetUnits.reduce((a, b) => a + b, 0);
    const totalActualUnits = actuals.units.reduce((a, b) => a + b, 0);

    html += `
      <tr class="total-row">
        <td><strong>合計</strong></td>
        <td><strong>${totalPlan.toFixed(2)}</strong></td>
        <td><strong>${totalArea.toFixed(2)}</strong></td>
        <td><strong>${totalDiff > 0 ? "+" : ""}${totalDiff.toFixed(2)}</strong></td>
        <td><strong>${Math.round(totalTargetKg).toLocaleString()}</strong></td>
        <td><strong>${Math.round(totalActualKg).toLocaleString()}</strong></td>
        <td><strong>${Math.round(totalTargetUnits).toLocaleString()}</strong></td>
        <td><strong>${Math.round(totalActualUnits).toLocaleString()}</strong></td>
      </tr>
    `;

    html += "</tbody></table>";
    return html;
}

/* ===============================
   7. 年ごとの KPI を生成
=============================== */
async function renderKpiForYear(year) {
    log(`===== ${year}年 KPI 生成開始 =====`);

    const harvestBase = await loadJSON("data/harvestBase.json");
    const plantingList = await loadPlantingRefsForYear(year);
    const weightRows = await loadCSV("logs/weight/all.csv");

    // ★ shippingDate ベースで実績を抽出
    const filteredWeightRows = weightRows.filter(row => {
        const d = new Date(row.shippingDate);
        return d.getFullYear() === year;
    });

    const weightMap = groupWeightByRef(filteredWeightRows);

    const planArea = Array(12).fill(0);
    const areaMonthly = Array(12).fill(0);
    const actuals = { kg: Array(12).fill(0), units: Array(12).fill(0) };

    // ★ shippingDate ベースで実績集計
    filteredWeightRows.forEach(row => {
        const d = new Date(row.shippingDate);
        const m = d.getMonth();
        actuals.kg[m] += Number(row.totalWeight || 0);
        actuals.units[m] += Number(row.bins || 0);
    });

    // ★ plantingRef の予定面積と収穫面積割当
    const refDatas = await Promise.all(
        plantingList.map(item =>
            loadJSON(`logs/summary/${item.field}/${item.year}/${item.file}`)
        )
    );

    for (let i = 0; i < plantingList.length; i++) {
        const item = plantingList[i];
        const ref = refDatas[i];

        const area = calcAreaTan(ref.planting);
        const w = weightMap[item.plantingRef];

        // 予定面積（harvestPlanYM ベース）
        const ym = ref.planting.harvestPlanYM;
        if (ym) {
            const planMonth = Number(ym.split("-")[1]) - 1;
            planArea[planMonth] += area;
        }

        // 収穫面積（shippingDate ベース）
        if (w && w.totalKg > 0) {
            for (let m = 0; m < 12; m++) {
                const ratio = w.monthlyKg[m] / w.totalKg;
                areaMonthly[m] += area * ratio;
            }
        }
    }

    const targets = calcTargets(planArea, harvestBase);

    return renderKpiTable(planArea, areaMonthly, actuals, targets, year);
}

/* ===============================
   8. 年ごとに <details> を生成して表示
=============================== */
export async function renderKpiPage() {
    log("KPI ページ描画開始");

    const years = await getYearList();
    let html = "";

    for (const year of years) {
        html += `
      <details>
        <summary>${year} 年</summary>
        <div id="kpi-${year}" class="kpi-block">読み込み中...</div>
      </details>
    `;
    }

    document.getElementById("kpi-container").innerHTML = html;

    for (const year of years) {
        const container = document.getElementById(`kpi-${year}`);
        container.innerHTML = await renderKpiForYear(year);
    }

    log("KPI ページ描画完了");
}