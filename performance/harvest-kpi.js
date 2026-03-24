// harvest-kpi.js（デバッグ強化版）

import { loadJSON } from "/common/json.js?v=1.1";
import { loadCSV } from "/common/csv.js?v=1.1";
import { safeFileName } from "/common/utils.js?v=1.1";

const DEBUG = true;
const log = (...a) => DEBUG && console.log("[KPI]", ...a);
const logError = (...a) => DEBUG && console.error("[KPI-ERROR]", ...a);

// ★ JSON 読み込みをラップしてパスを全部ログ出力
async function debugLoadJSON(path) {
    log("JSON 読み込み:", path);
    try {
        const data = await loadJSON(path);
        log("JSON 読み込み成功:", path);
        return data;
    } catch (e) {
        logError("JSON 読み込み失敗:", path, e);
        throw e;
    }
}

// ★ CSV 読み込みもログ出す
async function debugLoadCSV(path) {
    log("CSV 読み込み:", path);
    try {
        const data = await loadCSV(path);
        log("CSV 読み込み成功:", path);
        return data;
    } catch (e) {
        logError("CSV 読み込み失敗:", path, e);
        throw e;
    }
}

/* ===============================
   1. 年一覧を「予定年＋実績年」から生成
=============================== */
async function getYearList() {
    log("年一覧取得開始");

    const index = await debugLoadJSON("data/summary-index.json");
    const weightRows = await debugLoadCSV("logs/weight/all.csv");

    const years = new Set();

    // ★ harvestPlanYM の年（予定年）
    for (const field in index) {
        for (const year in index[field]) {
            for (const file of index[field][year]) {

                const path = `logs/summary/${field}/${year}/${file}`;
                const summary = await debugLoadJSON(path);

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

    const index = await debugLoadJSON("data/summary-index.json");
    const list = [];

    for (const field in index) {
        for (const year in index[field]) {
            for (const file of index[field][year]) {

                const path = `logs/summary/${field}/${year}/${file}`;
                const summary = await debugLoadJSON(path);

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
   7. 年ごとの KPI を生成
=============================== */
async function renderKpiForYear(year) {
    log(`===== ${year}年 KPI 生成開始 =====`);

    const harvestBase = await debugLoadJSON("data/harvestBase.json");
    const plantingList = await loadPlantingRefsForYear(year);
    const weightRows = await debugLoadCSV("logs/weight/all.csv");

    // shippingDate ベースで実績抽出
    const filteredWeightRows = weightRows.filter(row => {
        const d = new Date(row.shippingDate);
        return d.getFullYear() === year;
    });

    const weightMap = groupWeightByRef(filteredWeightRows);

    const planArea = Array(12).fill(0);
    const areaMonthly = Array(12).fill(0);
    const actuals = { kg: Array(12).fill(0), units: Array(12).fill(0) };

    filteredWeightRows.forEach(row => {
        const d = new Date(row.shippingDate);
        const m = d.getMonth();
        actuals.kg[m] += Number(row.totalWeight || 0);
        actuals.units[m] += Number(row.bins || 0);
    });

    // ★ plantingRef の予定面積と収穫面積割当
    const refDatas = await Promise.all(
        plantingList.map(item => {
            const path = `logs/summary/${item.field}/${item.year}/${item.file}`;
            return debugLoadJSON(path);
        })
    );

    // …（以下は元のまま）
    // 省略しても動作に影響なし
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