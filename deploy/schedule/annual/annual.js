// annual.js（メイン制御）

import { loadJSON, saveJSON } from "/common/json.js";
import { initStep1 } from "./annual-step1.js";
import { initStep2 } from "./annual-step2.js";

window.addEventListener("DOMContentLoaded", async () => {

  const year = new URLSearchParams(location.search).get("year");
  document.getElementById("pageTitle").textContent = `${year} 年間作付計画`;

  // 既存ファイル or 新規作成
  let annual;
  try {
    annual = await loadJSON(`/logs/schedule/annual/${year}-作付計画.json`);
  } catch {
    annual = createEmptyAnnual(year);
  }

  // STEP1 初期化
  initStep1(annual);

  // STEP2 初期化
  initStep2(annual);

  // 保存
  document.getElementById("save").addEventListener("click", async () => {
    await saveJSON(`logs/schedule/annual/${year}-作付計画.json`, annual);
    document.getElementById("saveStatus").textContent = "保存しました";
  });
});

function createEmptyAnnual(year) {
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
