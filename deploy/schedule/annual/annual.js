// annual.js（saveLog 方式・年階層構造対応・フィルタ初期化付き）

import { loadJSON } from "/common/json.js";
import { saveLog } from "/common/save/index.js";
import { initStep1 } from "./annual-step1.js";
import { initStep2 } from "./annual-step2.js";

import { setFilterData } from "/common/filter/filter-core.js";   // ★ 品種選択モーダルに必須

const DEBUG = true;
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
  log("[INFO] loadPath =", loadPath);
  log("[INFO] savePath =", savePath);

  document.getElementById("pageTitle").textContent = `${year} 年間作付計画`;

  // ---------------------------------------------------------
  // ★ フィルタ用データを読み込む（STEP2 の品種選択に必須）
  // ---------------------------------------------------------
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

    // ★ フィルタデータをセット（select モードで使用）
    setFilterData({
      years: [],
      months: {},
      fields: { parents: areaOrder, children: areaMap },
      varieties: { parents: typeOrder, children: typeMap }
    });

    log("[INFO] setFilterData 完了");
  } catch (e) {
    error("[ERROR] フィルタデータ読み込み失敗:", e);
  }

  // ---------------------------------------------------------
  // annual.json 読み込み
  // ---------------------------------------------------------
  let annualAll;
  try {
    log("[loadJSON] 読み込み開始:", loadPath);
    annualAll = await loadJSON(loadPath);
    log("[loadJSON] 読み込み成功:", JSON.parse(JSON.stringify(annualAll)));
  } catch (e) {
    warn("[loadJSON] 読み込み失敗 → 空で開始:", e);
    annualAll = {};
  }

  // ---------------------------------------------------------
  // 年データが無ければ新規作成
  // ---------------------------------------------------------
  if (!annualAll[year]) {
    log(`[INFO] ${year} のデータが無いため新規作成`);
    annualAll[year] = createEmptyAnnual(year);
  }

  const annual = annualAll[year];

  // ---------------------------------------------------------
  // STEP1 / STEP2 初期化
  // ---------------------------------------------------------
  initStep1(annual);
  initStep2(annual);

  // ---------------------------------------------------------
  // 保存（saveLog 方式）
  // ---------------------------------------------------------
  const saveButton = document.getElementById("save");

  const doSave = async () => {
    log("=== SAVE BUTTON CLICKED ===");
    log("[saveLog] 保存データ annualAll =", JSON.parse(JSON.stringify(annualAll)));

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

      log("[saveLog] 保存成功:", savePath);
      document.getElementById("saveStatus").textContent = "保存しました";
    } catch (e) {
      error("[saveLog] 保存失敗:", e);
      document.getElementById("saveStatus").textContent = "保存に失敗（コンソール参照）";
    }
  };

  saveButton.addEventListener("click", doSave);

  // ---------------------------------------------------------
  // STEP1 / STEP2 の保存ボタン → 共通保存を呼ぶ
  // ---------------------------------------------------------
  const saveStep1Button = document.getElementById("saveStep1");
  if (saveStep1Button) {
    saveStep1Button.addEventListener("click", () => saveButton.click());
  }

  const saveStep2Button = document.getElementById("saveStep2");
  if (saveStep2Button) {
    saveStep2Button.addEventListener("click", () => saveButton.click());
  }
});

// ---------------------------------------------------------
// 年データの初期構造
// ---------------------------------------------------------
function createEmptyAnnual(year) {
  log("[createEmptyAnnual] 新規作成 year =", year);

  return {
    year,
    step1: {
      months: [
        "11", "12", "01", "02", "03", "04", "05", "06"
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
