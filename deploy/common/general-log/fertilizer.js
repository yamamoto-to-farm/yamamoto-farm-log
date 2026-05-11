// =========================================================
// common/general-log/fertilizer.js
// 施肥ログ専用ラッパー（base.js を呼ぶだけ）
// =========================================================

import { saveMultiFieldLog } from "./base.js?v=1";

/**
 * 施肥ログを保存する
 *
 * @param {Object} input
 * @param {string} input.date
 * @param {string[]} input.fields
 * @param {Array} input.distributed  // ★ 按分済み
 * @param {string} input.machine
 * @param {string} input.worker
 * @param {string} input.notes
 */
export function saveFertilizerLog(input) {
  return saveMultiFieldLog({
    type: "fertilizer",
    date: input.date,
    fields: input.fields,
    entry: {
      distributed: input.distributed,   // ★ ここがメイン
      machine: input.machine,
      worker: input.worker,
      notes: input.notes || ""
    }
  });
}
