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

  const sourceMap = new Map();
  (Array.isArray(pesticides) ? pesticides : []).forEach(item => {
    const key = String(item?.name || "").trim();
    if (!key) return;
    sourceMap.set(key, {
      category: String(item?.category || "").trim(),
      materialType: String(item?.materialType || "pesticide"),
      sourceMaster: String(item?.sourceMaster || "pesticide-index")
    });
  });

  const enriched = (Array.isArray(result) ? result : []).map(row => {
    const source = sourceMap.get(String(row?.name || "").trim()) || {};
    return {
      ...row,
      ...(source.category ? { category: source.category } : {}),
      ...(source.materialType ? { materialType: source.materialType } : {}),
      ...(source.sourceMaster ? { sourceMaster: source.sourceMaster } : {})
    };
  });

  debugLog("distributepesticides result:", enriched);
  return enriched;
}
