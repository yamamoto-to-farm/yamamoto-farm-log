// annual.js（メイン制御・デバッグフラグ付き）

import { loadJSON, saveJSON } from "/common/json.js";
import { initStep1 } from "./annual-step1.js";
import { initStep2 } from "./annual-step2.js";

// ★ デバッグフラグ（必要なときだけ true にする）
const DEBUG = true;

// ログ出力ヘルパー
function log(...args) {
  if (DEBUG) console.log(...args);
}
function warn(...args) {
  if (DEBUG) console.warn(...args);
}
function error(...args) {
  if (DEBUG) console.error(...args);
}

window.addEventListener("DOMContentLoaded", async () => {

  const year = new URLSearchParams(location.search).get("year");

  // 読み込みは CloudFront → "/" 必須
  const loadPath = `/logs/schedule/annual/${year}-作付計画.json`;

  // 保存は Lambda → S3 → "/" なし
  const savePath = `logs/schedule/annual/${year}-作付計画.json`;

  log("=== Annual Init ===");
  log("[INFO] year =", year);
  log("[INFO] loadPath =", loadPath);
  log("[INFO] savePath =", savePath);

  document.getElementById("pageTitle").textContent = `${year} 年間作付計画`;

  // ---------------------------------------------------------
  // JSON 読み込み（既存 or 新規）
  // ---------------------------------------------------------
  let annual;
  try {
    log("[loadJSON] 読み込み開始:", loadPath);
    annual = await loadJSON(loadPath);
    log("[loadJSON] 読み込み成功:", JSON.parse(JSON.stringify(annual)));
  } catch (e) {
    warn("[loadJSON] 読み込み失敗 → 新規作成モード:", e);
    annual = createEmptyAnnual(year);
    log("[createEmptyAnnual] annual =", JSON.parse(JSON.stringify(annual)));
  }

  // ---------------------------------------------------------
  // STEP1 初期化
  // ---------------------------------------------------------
  log("[initStep1] 初期化開始");
  initStep1(annual);
  log("[initStep1] 初期化完了");

  // ---------------------------------------------------------
  // STEP2 初期化
  // ---------------------------------------------------------
  log("[initStep2] 初期化開始");
  initStep2(annual);
  log("[initStep2] 初期化完了");

  // ---------------------------------------------------------
  // 保存ボタン
  // ---------------------------------------------------------
  document.getElementById("save").addEventListener("click", async () => {
    log("=== SAVE BUTTON CLICKED ===");
    log("[saveJSON] 保存開始:", savePath);
    log("[saveJSON] 保存データ annual =", JSON.parse(JSON.stringify(annual)));

    try {
      const result = await saveJSON(savePath, annual);
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
// 新規作成 annual の構造
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
