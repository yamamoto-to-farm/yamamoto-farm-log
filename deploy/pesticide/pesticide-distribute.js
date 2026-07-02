// /pesticide/pesticide-distribute.js

// ===============================
// デバッグフラグ
// ===============================
const DEBUG = true;

function debugLog(...args) {
  if (DEBUG) console.log("[pesticide-distribute]", ...args);
}

import { distributeByFieldSize } from "/common/field-utils.js?v=1";

/* ============================================================
   複数農薬の按分
   pesticides = [
     { pesticide_id, name, dilution_rate, total_spray_amount, unit }
   ]
   fields = ["ぎょうざ東1", "ぎょうざ東2"]
============================================================ */
export async function distributepesticides(fields, pesticides) {
  debugLog("distributepesticides start", { fields, pesticides });

  const result = [];

  for (const pesticide of pesticides) {
    const {
      pesticide_id,
      name,
      dilution_rate,
      total_spray_amount,
      unit
    } = pesticide;

    debugLog(`按分開始: ${name} total=${total_spray_amount}`);

    // ★ 面積比で按分（共通ロジック）
    const distributed = await distributeByFieldSize(fields, total_spray_amount);

    debugLog(`按分結果: ${name}`, distributed);

    // 保存しやすい形に整形
    distributed.forEach(d => {
      result.push({
        field: d.field,
        pesticide_id,
        name,
        dilution_rate,
        unit,
        spray_amount: d.amount
      });
    });
  }

  debugLog("distributepesticides result:", result);
  return result;
}
