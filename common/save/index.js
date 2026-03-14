// common/save/index.js

/**
 * saveLog(payload)
 *
 * payload は 2 つの形式をサポートする：
 *
 * ① 従来の単体保存
 * {
 *   type: "summary",
 *   dateStr: "logs/summary/三角畑_下/2025/xxx.json",
 *   json: "{...}",
 *   csv: "",
 *   replaceCsv: ""
 * }
 *
 * ② multi 保存（複数ファイルを一度に保存）
 * {
 *   type: "multi",
 *   files: [
 *     { path: "logs/summary/...", content: "{...}" },
 *     { path: "data/summary-index.json", content: "{...}" }
 *   ]
 * }
 */

export async function saveLog(payloadOrType, dateStr, jsonData, csvLine, replaceCsv = "") {
  let payload;

  // ---------------------------------------------------------
  // A. 新しい multi-saveLog 形式（payload を直接渡す）
  // ---------------------------------------------------------
  if (typeof payloadOrType === "object") {
    payload = payloadOrType;
  }

  // ---------------------------------------------------------
  // B. 従来の形式（type, dateStr, jsonData...）
  // ---------------------------------------------------------
  else {
    payload = {
      type: payloadOrType,
      dateStr,
      json: jsonData,
      csv: csvLine,
      replaceCsv
    };
  }

  // ---------------------------------------------------------
  // C. 保存サーバーへ送信
  // ---------------------------------------------------------
  const res = await fetch(
    "https://raspy-poetry-cf6f.yamamoto-to-farm.workers.dev",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }
  );

  if (!res.ok) {
    throw new Error("保存サーバーへの送信に失敗");
  }
}