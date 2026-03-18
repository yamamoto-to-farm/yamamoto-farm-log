// common/save/index.js

import { readText } from "../github.js";
import { loadCSV } from "../csv.js";

const saveQueue = [];
let saving = false;

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

function enqueueSave(payload) {
  return new Promise((resolve, reject) => {
    saveQueue.push({ payload, resolve, reject });
    processQueue();
  });
}

async function processQueue() {
  if (saving) return;
  if (saveQueue.length === 0) return;

  saving = true;

  const { payload, resolve, reject } = saveQueue.shift();

  try {
    // -----------------------------
    // 1. 保存前の内容を取得
    // -----------------------------
    let before = null;

    if (payload.type === "multi") {
      // multi の場合は確認しない（大量なので）
    } else if (payload.csv && payload.replaceCsv === "") {
      // CSV append の場合
      before = await loadCSV(`logs/${payload.type}/all.csv`);
    } else if (payload.json) {
      // JSON の場合
      before = await readText(payload.dateStr);
    }

    // -----------------------------
    // 2. Worker に保存リクエスト
    // -----------------------------
    const res = await fetch(
      "https://raspy-poetry-cf6f.yamamoto-to-farm.workers.dev",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }
    );

    if (!res.ok) throw new Error("保存サーバーへの送信に失敗");

    // -----------------------------
    // 3. 保存後の内容を取得して比較
    // -----------------------------
    if (before !== null) {
      let after;

      if (payload.csv && payload.replaceCsv === "") {
        after = await loadCSV(`logs/${payload.type}/all.csv`);
        if (after.length <= before.length) {
          throw new Error("CSV が更新されていません");
        }
      } else if (payload.json) {
        after = await readText(payload.dateStr);
        if (after.trim() === before.trim()) {
          throw new Error("JSON が更新されていません");
        }
      }
    }

    resolve();
  } catch (e) {
    reject(e);
  }

  saving = false;
  processQueue();
}