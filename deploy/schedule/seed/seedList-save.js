// schedule/seed/seedList-save.js

import { getRows } from "./seedList-state.js";
import { getCurrentYear } from "./seedList-load.js";
import { renderTable } from "./seedList-render.js";
import { saveLog } from "../../common/save/index.js";

/* ---------------------------------------------------------
   デバッグ切り替え（localStorage）
--------------------------------------------------------- */
function isDebug() {
  return localStorage.getItem("debugSeedListSave") === "1";
}

function dbg(...args) {
  if (isDebug()) console.log("[seedList-save]", ...args);
}

/* ===============================
   1. 入力済み行だけ抽出
=============================== */
function extractFilledRows() {
  const rows = getRows();
  dbg("rows:", rows);

  const filled = rows.filter(r =>
    r.planSowDate ||
    r.variety ||
    r.trayCount > 0 ||
    r.trayType ||
    r.planAreaPlan ||
    r.planAreaCalc ||
    r.daysToPlant > 0 ||
    r.planPlantDate ||
    r.harvestPlanYM ||
    r.source ||
    r.memo
  );

  dbg("filled rows:", filled);
  return filled;
}

/* ===============================
   2. CSV（ヘッダあり）に変換
=============================== */
function convertToCsv(rows) {
  const header = [
    "sowDate",
    "variety",
    "trayCount",
    "trayType",
    "spacingRow",
    "spacingBed",
    "planAreaPlan",
    "planAreaCalc",
    "daysToPlant",
    "planPlantDate",
    "harvestMonth",
    "harvestPlanYM",
    "harvestWeek",
    "source",
    "memo"
  ];

  const lines = [];
  lines.push(header.join(","));

  rows.forEach(r => {
    const cols = [
      r.planSowDate || "",
      r.variety || "",
      r.trayCount || 0,
      r.trayType || "",
      r.spacingRow ?? "",
      r.spacingBed ?? "",
      r.planAreaPlan || "",
      r.planAreaCalc || "",
      r.daysToPlant || "",
      r.planPlantDate || "",
      r.harvestMonth || "",
      r.harvestPlanYM || "",
      r.harvestWeek || "",
      (r.source || "").replace(/,/g, "、"),
      (r.memo || "").replace(/,/g, "、")
    ];

    lines.push(cols.map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));
  });

  const csv = lines.join("\n") + "\n";
  dbg("csv:\n" + csv);
  return csv;
}

/* ===============================
   3. メイン処理（年度ごと CSV replace）
=============================== */
export async function saveSeedList() {
  dbg("=== saveSeedList START ===");

  const filled = extractFilledRows();
  if (filled.length === 0) {
    alert("入力されている行がありません。");
    dbg("no filled rows → abort");
    return;
  }

  const csv = convertToCsv(filled);
  const year = getCurrentYear();

  try {
    dbg("calling saveLog replace…");

    await saveLog(
      "schedule/seed",     // 保存フォルダ
      `${year}`,           // dateStr（互換用）
      {},                  // JSON なし
      "",                  // append なし
      csv,                 // replaceCsv（CSV 本体）
      `${year}.csv`        // ★ 正しい fileName
    );

    dbg("saveLog completed");

  } catch (e) {
    console.error("❌ saveSeedList error:", e);
    alert("保存に失敗しました（Console を確認してください）");
  }

  dbg("=== saveSeedList END ===");
}
