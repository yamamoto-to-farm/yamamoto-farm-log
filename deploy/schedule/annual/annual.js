// annual.js（saveLog 方式・年階層構造対応・フィルタ初期化付き）

import { loadJSON } from "/common/json.js";
import { saveLog } from "/common/save/index.js";
import { initStep1 } from "./annual-step1.js";
import { initStep2 } from "./annual-step2.js";

import { setFilterData } from "/common/filter/filter-core.js";   // ★ 品種選択モーダルに必須

const DEBUG = false;
const log = (...a) => DEBUG && console.log(...a);
const warn = (...a) => DEBUG && console.warn(...a);
const error = (...a) => DEBUG && console.error(...a);

window.addEventListener("DOMContentLoaded", async () => {
    const year = new URLSearchParams(location.search).get("year");

    // annual.json（固定ファイル）
    const loadPath = `/logs/schedule/annual/annual.json`;
    const savePath = `logs/schedule/annual/annual.json`;  // saveLog 用の S3 Key

    log("=== Annual Init ===");
    log("[INFO] year =", year);

    document.getElementById("pageTitle").textContent = `${year} 年間作付計画`;

    /* ---------------------------------------------------------
       フィルタ用データ（品種選択モーダル用）
    --------------------------------------------------------- */
    try {
        const fields = await loadJSON("/data/fields.json");
        const varieties = await loadJSON("/data/varieties.json");

        const areaMap = {};
        const areaOrder = [];
        fields.forEach(f => {
            if (!areaMap[f.area]) {
                areaMap[f.area] = [];
                areaOrder.push(f.area);
            }
            areaMap[f.area].push(f.name);
        });

        const typeMap = {};
        const typeOrder = [];
        varieties.forEach(v => {
            if (!typeMap[v.type]) {
                typeMap[v.type] = [];
                typeOrder.push(v.type);
            }
            typeMap[v.type].push(v.name);
        });

        setFilterData({
            years: [],
            months: {},
            fields: { parents: areaOrder, children: areaMap },
            varieties: { parents: typeOrder, children: typeMap }
        });

    } catch (e) {
        error("[ERROR] フィルタデータ読み込み失敗:", e);
    }

    /* ---------------------------------------------------------
       annual.json 読み込み
    --------------------------------------------------------- */
    let annualAll;
    try {
        annualAll = await loadJSON(loadPath);
    } catch (e) {
        warn("[loadJSON] 読み込み失敗 → 空で開始:", e);
        annualAll = {};
    }

    /* ---------------------------------------------------------
       年データが無ければ新規作成（YYYY-MM 方式）
    --------------------------------------------------------- */
    if (!annualAll[year]) {
        annualAll[year] = createEmptyAnnual(year);
    }

    const annual = annualAll[year];

    /* ---------------------------------------------------------
       STEP1 / STEP2 初期化
    --------------------------------------------------------- */
    initStep1(annual);
    initStep2(annual);

    /* ---------------------------------------------------------
       保存（saveLog）
    --------------------------------------------------------- */
    const saveButton = document.getElementById("save");

    const doSave = async () => {
        try {
            await saveLog({
                type: "multi",
                files: [
                    {
                        path: savePath,
                        content: JSON.stringify(annualAll, null, 2)
                    }
                ]
            });

            document.getElementById("saveStatus").textContent = "保存しました";
        } catch (e) {
            error("[saveLog] 保存失敗:", e);
            document.getElementById("saveStatus").textContent = "保存に失敗（コンソール参照）";
        }
    };

    saveButton.addEventListener("click", doSave);

    /* ---------------------------------------------------------
       STEP1 / STEP2 の保存ボタン → 共通保存を呼ぶ
    --------------------------------------------------------- */
    const saveStep1Button = document.getElementById("saveStep1");
    if (saveStep1Button) {
        saveStep1Button.addEventListener("click", () => saveButton.click());
    }

    const saveStep2Button = document.getElementById("saveStep2");
    if (saveStep2Button) {
        saveStep2Button.addEventListener("click", () => saveButton.click());
    }
});

/* ---------------------------------------------------------
   年データの初期構造（YYYY-MM 方式）
--------------------------------------------------------- */
function createEmptyAnnual(year) {
    const y = Number(year);
    const next = y + 1;

    return {
        year,
        step1: {
            months: [
                `${y}-11`,
                `${y}-12`,
                `${next}-01`,
                `${next}-02`,
                `${next}-03`,
                `${next}-04`,
                `${next}-05`,
                `${next}-06`
            ].map(m => ({
                month: m,
                targetUnits: "",
                unitsPer10a: "",
                yieldPer10a: "",
                needArea: ""
            }))
        },
        step2: {
            rows: []
        }
    };
}
