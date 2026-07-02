// =========================================================
// common/general-log/pesticide.js
// 防除ログ専用ラッパー（base.js を呼ぶだけ）
// =========================================================

import { saveMultiFieldLog } from "./base.js?v=1";

/**
 * 防除ログを保存する
 *
 * @param {Object} input
 * @param {string} input.date
 * @param {string[]} input.fields
 * @param {Array} input.distributed  // 按分済み
 * @param {string} input.machine
 * @param {string|string[]} [input.worker]
 * @param {string|string[]} [input.workers]
 * @param {string} [input.notes]
 */
export function savePesticideLog(input) {
	return saveMultiFieldLog({
		type: "pesticide",
		date: input.date,
		fields: input.fields,
		entry: {
			distributed: input.distributed,
			machine: input.machine,
			worker: input.worker,
			workers: input.workers,
			notes: input.notes || ""
		}
	});
}
