// common/save/index.js

import { readText } from "../github.js";
import { loadCSV } from "../csv.js";

// ------------------------------
// 保存キュー
// ------------------------------
const saveQueue = [];
let saving = false;

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

  const { payload, resolve, reject } = saveQueue.shift();

  try {
    // ------------------------------
    // 1. 保存前の内容を取得
    // ------------------------------
    let beforeCount = null;

    if (payload.type === "multi") {
      // multi は確認しない
    } else if (payload.csv && payload.replaceCsv === "") {
      // CSV append の場合 → 行数だけ確認
      const before = await loadCSV(`logs/${payload.type}/all.csv`);
      beforeCount = before.length;
    } else if (payload.json) {
      // JSON → ファイルが読めれば OK（内容比較しない）
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
    // 3. 保存後の更新確認（軽量・誤検知ゼロ）
    // ------------------------------
    if (beforeCount !== null) {
      let updated = false;

      // 最大10回リトライ（300ms × 10 = 最大3秒）
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 300));

        const after = await loadCSV(`logs/${payload.type}/all.csv`);
        if (after.length > beforeCount) {
          updated = true;
          break;
        }
      }

      if (!updated) {
        throw new Error("保存は完了しましたが、CSV の更新確認ができませんでした");
      }
    }

    // JSON の場合は readText が成功すれば OK（内容比較しない）
    if (payload.json) {
      let ok = false;

      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 300));

        try {
          await readText(payload.dateStr);
          ok = true;
          break;
        } catch (_) {}
      }

      if (!ok) {
        throw new Error("保存は完了しましたが、JSON の更新確認ができませんでした");
      }
    }

    resolve();
  } catch (e) {
    reject(e);
  }

  saving = false;
  processQueue();
}