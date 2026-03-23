// common/save/index.js

const PRESIGN_URL = "https://7bx9hgk4d1.execute-api.ap-northeast-1.amazonaws.com/prod/presign";

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

  return saveToS3(payload);
}

async function saveToS3(payload) {
  dbg("=== saveToS3 START ===");

  const files = [];

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

    if (payload.csv && payload.replaceCsv === "") {
      throw new Error("append は append API に移行する必要があります");
    }

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

    // ★ Content-Type を送らない（署名と一致させるため）
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
}

function guessType(path) {
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".csv")) return "application/octet-stream";
  return "text/plain";
}