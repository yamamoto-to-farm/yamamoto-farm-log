// common/save/index.js

import { readText } from "../github.js";
import { loadCSV } from "../csv.js";

// ------------------------------
// 保存キュー
// ------------------------------
const saveQueue = [];
let saving = false;

// ------------------------------
// UI フック（外部から登録される）
// ------------------------------
export let onSavingStart = null;
export let onSavingEnd = null;

// ------------------------------
// saveLog（名前はそのまま）
// ------------------------------
export async function saveLog(payloadOrType, dateStr, jsonData, csvLine, replaceCsv = "") {
  let payload;

  // A. multi-saveLog 形式
  if (typeof payloadOrType === "object") {
    payload = payloadOrType;
  }
  // B. 従来形式
  else {
    payload = {
      type: payloadOrType,
      dateStr,
      json: jsonData,
      csv: csvLine,
      replaceCsv
    };
  }

  return enqueueSave(payload);
}

// ------------------------------
// キューに追加
// ------------------------------
function enqueueSave(payload) {
  return new Promise((resolve, reject) => {
    saveQueue.push({ payload, resolve, reject });
    processQueue();
  });
}

// ------------------------------
// キュー処理（直列化）
// ------------------------------
async function processQueue() {
  if (saving) return;
  if (saveQueue.length === 0) return;

  saving = true;

  // ▼ 保存開始イベント（UIロック）
  if (onSavingStart) {
    try { onSavingStart(); } catch (_) {}
  }

  const { payload, resolve, reject } = saveQueue.shift();

  try {
    // ------------------------------
    // 1. 保存前の内容を取得
    // ------------------------------
    let beforeCount = null;

    if (payload.type === "multi") {
      // multi は確認しない
    } else if (payload.csv && payload.replaceCsv === "") {
      const before = await loadCSV(`logs/${payload.type}/all.csv`);
      beforeCount = before.length;
    } else if (payload.json) {
      await readText(payload.dateStr).catch(() => {});
    }

    // ------------------------------
    // 2. Worker に保存リクエスト
    // ------------------------------
    const res = await fetch(
      "https://raspy-poetry-cf6f.yamamoto-to-farm.workers.dev",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }
    );

    if (!res.ok) throw new Error("保存サーバーへの送信に失敗");

    // ------------------------------
    // 3. 保存後の更新確認（最大10秒）
    // ------------------------------
    if (beforeCount !== null) {
      let updated = false;

      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 500));

        const after = await loadCSV(`logs/${payload.type}/all.csv`);
        if (after.length > beforeCount) {
          updated = true;
          break;
        }
      }

      if (!updated) {
        console.warn("CSV 更新確認できず（raw 遅延の可能性）→ 保存成功扱い");
      }
    }

    if (payload.json) {
      let ok = false;

      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 500));

        try {
          await readText(payload.dateStr);
          ok = true;
          break;
        } catch (_) {}
      }

      if (!ok) {
        console.warn("JSON 更新確認できず（raw 遅延の可能性）→ 保存成功扱い");
      }
    }

    resolve();
  } catch (e) {
    reject(e);
  }

  // ▼ 保存終了イベント（UI解除）
  if (onSavingEnd) {
    try { onSavingEnd(); } catch (_) {}
  }

  saving = false;
  processQueue();
}