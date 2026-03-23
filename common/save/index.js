// common/save/index.js

const PRESIGN_URL = "https://7bx9hgk4d1.execute-api.ap-northeast-1.amazonaws.com/prod/presign";

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

  return saveToS3(payload);
}

async function saveToS3(payload) {
  const files = [];

  // ------------------------------
  // 1. 保存対象ファイルを決定
  // ------------------------------
  if (payload.type === "multi") {
    // multi は複数ファイル
    for (const f of payload.files) {
      files.push({
        key: f.path,
        content: f.content,
        contentType: guessType(f.path)
      });
    }
  } else {
    // JSON 保存
    if (payload.json) {
      let key = payload.dateStr;

      // ★★★ 拡張子がなければ .json を付ける
      if (!key.endsWith(".json")) {
        key = key + ".json";
      }

      files.push({
        key,
        content: JSON.stringify(payload.json, null, 2),
        contentType: "application/json"
      });
    }

    // CSV append（後で Lambda 化）
    if (payload.csv && payload.replaceCsv === "") {
      throw new Error("append は append API に移行する必要があります");
    }

    // CSV 全書き換え
    if (payload.replaceCsv !== "") {
      files.push({
        key: `logs/${payload.type}/all.csv`,
        content: payload.replaceCsv,
        // ★★★ CSV は application/octet-stream に統一
        contentType: "application/octet-stream"
      });
    }
  }

  // ------------------------------
  // 2. presign → PUT
  // ------------------------------
  for (const file of files) {
    // presign
    const presignRes = await fetch(PRESIGN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: file.key,
        contentType: file.contentType
      })
    });

    const { url } = await presignRes.json();

    // PUT
    await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": file.contentType },
      body: file.content
    });
  }
}

function guessType(path) {
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".csv")) return "application/octet-stream"; // ★ CSV はこれ
  return "text/plain";
}