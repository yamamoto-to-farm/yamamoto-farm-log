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
   複数肥料の按分
   pesticides = [
     { pesticide_id, name, bags, total_kg }
   ]
   fields = ["ぎょうざ東1", "ぎょうざ東2"]
============================================================ */
export async function distributepesticides(fields, pesticides) {
  debugLog("distributepesticides start", { fields, pesticides });

  const result = [];

  for (const fert of pesticides) {
    const { pesticide_id, name, total_kg } = fert;

    debugLog(`按分開始: ${name} total=${total_kg}`);

    // ★ 面積比で按分（共通ロジック）
    const distributed = await distributeByFieldSize(fields, total_kg);

    debugLog(`按分結果: ${name}`, distributed);

    // 保存しやすい形に整形
    distributed.forEach(d => {
      result.push({
        field: d.field,
        pesticide_id,
        name,
        amount_kg: d.amount
      });
    });
  }

  debugLog("distributepesticides result:", result);
  return result;
}
