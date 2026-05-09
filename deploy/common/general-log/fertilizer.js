// =========================================================
// common/general-log/fertilizer.js
// 施肥ログ専用ラッパー（base.js を呼ぶだけ）
// =========================================================

import { saveMultiFieldLog } from "./base.js?v=1";

/**
 * 施肥ログを保存する
 *
 * @param {Object} input
 * @param {string} input.date - "2026-05-10"
 * @param {string[]} input.fields - ["ぎょうざ東1", "ぎょうざ東2"]
 * @param {string} input.fertilizer_id - 肥料ID（硫安など）
 * @param {number} input.bags - 袋数（総数）
 * @param {Object} input.amount - { value: 60, unit: "kg" }
 * @param {string} input.machine - 使用機械
 * @param {string} input.worker - 作業者
 * @param {string} input.notes - 備考
 */
export function saveFertilizerLog(input) {
  return saveMultiFieldLog({
    type: "fertilizer",
    date: input.date,
    fields: input.fields,
    entry: {
      fertilizer_id: input.fertilizer_id,
      bags: input.bags,
      amount: input.amount,   // { value, unit }
      machine: input.machine,
      worker: input.worker,
      notes: input.notes || ""
    }
  });
}
