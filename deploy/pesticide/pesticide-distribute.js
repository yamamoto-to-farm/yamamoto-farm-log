// /pesticide/pesticide-distribute.js

// ===============================
// デバッグフラグ
// ===============================
const DEBUG = true;

function debugLog(...args) {
  if (DEBUG) console.log("[pesticide-distribute]", ...args);
}

import { distributePesticideUsageByField } from "/common/pesticide-calc.js?v=1";

/* ============================================================
   複数農薬の按分
   pesticides = [
     { pesticide_id, name, dilution_rate, total_spray_amount, unit }
   ]
   fields = ["ぎょうざ東1", "ぎょうざ東2"]
============================================================ */
export async function distributepesticides(fields, pesticides) {
  debugLog("distributepesticides start", { fields, pesticides });

  const result = await distributePesticideUsageByField(fields, pesticides);

  debugLog("distributepesticides result:", result);
  return result;
}
