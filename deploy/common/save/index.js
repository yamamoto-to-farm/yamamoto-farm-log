// common/save/index.js

import { showSaveModal, updateSaveModal, completeSaveModal }
  from "../save-modal.js?v=2026031418";

const PRESIGN_URL = "https://7bx9hgk4d1.execute-api.ap-northeast-1.amazonaws.com/prod/presign";
const APPEND_URL  = "https://kv4z4gjnq9.execute-api.ap-northeast-1.amazonaws.com/prod/append";

const DEBUG_SAVELOG = true;
function dbg(...args) {
  if (DEBUG_SAVELOG) console.log("[saveLog]", ...args);
}

export async function saveLog(payloadOrType, dateStr, jsonData, csvLine, replaceCsv = "") {
  let payload;

  if (typeof payloadOrType === "object") {
    payload = payloadOrType;
  } else {
    payload = {
      type: payloadOrType,
      dateStr,
      json: jsonData,
      csv: csvLine,
      replaceCsv
    };
  }

  dbg("=== saveLog START ===");
  dbg("payload:", payload);

  // ★ 保存開始モーダル
  showSaveModal("保存しています…");

  return saveToS3(payload);
}

async function saveToS3(payload) {
  dbg("=== saveToS3 START ===");

  // append モード
  if (payload.csv && payload.replaceCsv === "") {
    dbg("mode: append");

    const res = await fetch(APPEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: payload.type,
        line: payload.csv
      })
    });

    const json = await res.json();
    dbg("append result:", json);

    if (!res.ok) throw new Error("append failed");

    dbg("=== saveToS3 END (append) ===");

    // ★ 保存完了モーダル
    completeSaveModal("保存が完了しました");

    return;
  }

  const files = [];

  // multi モード
  if (payload.type === "multi") {
    dbg("mode: multi");

    for (const f of payload.files) {
      const type = guessType(f.path);
      dbg("multi file:", f.path, "type:", type);

      files.push({
        key: f.path,
        content: f.content,
        contentType: type
      });
    }
  } else {
    dbg("mode:", payload.type);

    // JSON 保存
    if (payload.json) {
      let key = payload.dateStr;
      if (!key.endsWith(".json")) key = key + ".json";

      dbg("JSON file:", key);

      files.push({
        key,
        content: JSON.stringify(payload.json, null, 2),
        contentType: "application/json"
      });
    }

    // CSV 全書き換え
    if (payload.replaceCsv !== "") {
      const key = `logs/${payload.type}/all.csv`;
      dbg("CSV file:", key);

      files.push({
        key,
        content: payload.replaceCsv,
        contentType: "application/octet-stream"
      });
    }
  }

  dbg("files to upload:", files);

  // presign → PUT
  for (const file of files) {
    dbg("---- presign request ----");
    dbg("key:", file.key);
    dbg("contentType:", file.contentType);

    const presignRes = await fetch(PRESIGN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: file.key,
        contentType: file.contentType
      })
    });

    const { url } = await presignRes.json();
    dbg("presigned URL:", url);

    dbg("---- PUT request ----");
    dbg("PUT to:", url);

    const putRes = await fetch(url, {
      method: "PUT",
      body: file.content
    });

    dbg("PUT status:", putRes.status);

    if (!putRes.ok) {
      const text = await putRes.text();
      dbg("PUT failed body:", text);
      throw new Error("PUT failed: " + putRes.status);
    }
  }

  dbg("=== saveToS3 END ===");

  // ★ 保存完了モーダル
  completeSaveModal("保存が完了しました");
}

function guessType(path) {
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".csv")) return "application/octet-stream";
  return "text/plain";
}