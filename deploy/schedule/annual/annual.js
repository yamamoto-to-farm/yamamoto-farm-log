// annual.js（年階層構造対応・デバッグフラグ付き）

import { loadJSON, saveJSON } from "/common/json.js";
import { initStep1 } from "./annual-step1.js";
import { initStep2 } from "./annual-step2.js";

const DEBUG = true;
const log = (...a) => DEBUG && console.log(...a);
const warn = (...a) => DEBUG && console.warn(...a);
const error = (...a) => DEBUG && console.error(...a);

window.addEventListener("DOMContentLoaded", async () => {

  const year = new URLSearchParams(location.search).get("year");

  // annual.json を読み込む（固定ファイル）
  const loadPath = `/logs/schedule/annual/annual.json`;
  const savePath = `logs/schedule/annual/annual.json`;

  log("=== Annual Init ===");
  log("[INFO] year =", year);
  log("[INFO] loadPath =", loadPath);
  log("[INFO] savePath =", savePath);

  document.getElementById("pageTitle").textContent = `${year} 年間作付計画`;

  // ---------------------------------------------------------
  // annual.json 読み込み
  // ---------------------------------------------------------
  let annualAll;
  try {
    log("[loadJSON] 読み込み開始:", loadPath);
    annualAll = await loadJSON(loadPath);
    log("[loadJSON] 読み込み成功:", JSON.parse(JSON.stringify(annualAll)));
  } catch (e) {
    warn("[loadJSON] 読み込み失敗 → 空オブジェクトで開始:", e);
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
  // 保存
  // ---------------------------------------------------------
  document.getElementById("save").addEventListener("click", async () => {
    log("=== SAVE BUTTON CLICKED ===");
    log("[saveJSON] 保存データ annualAll =", JSON.parse(JSON.stringify(annualAll)));

    try {
      const result = await saveJSON(savePath, annualAll);
      log("[saveJSON] 戻り値 =", result);
      log("[saveJSON] 保存成功:", savePath);
      document.getElementById("saveStatus").textContent = "保存しました";
    } catch (e) {
      error("[saveJSON] 保存失敗:", e);
      document.getElementById("saveStatus").textContent = "保存に失敗（コンソール参照）";
    }
  });
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
        "11","12","01","02","03","04","05","06"
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
