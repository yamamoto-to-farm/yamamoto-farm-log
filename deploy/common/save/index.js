// common/save/index.js

import {
  showSaveModal,
  updateSaveModal,
  completeSaveModal
} from "../save-modal.js?v=2026031418";
import { recordMonthlyWorkEntries } from "../monthly-work-summary.js?v=1";

const PRESIGN_URL =
  "https://7bx9hgk4d1.execute-api.ap-northeast-1.amazonaws.com/prod/presign";
const APPEND_URL =
  "https://kv4z4gjnq9.execute-api.ap-northeast-1.amazonaws.com/prod/append";
const SAVE_UPLOAD_CONCURRENCY = 4;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/* ---------------------------------------------------------
   デバッグ切り替え（localStorage）
--------------------------------------------------------- */
function isDebug() {
  return localStorage.getItem("debugSaveLog") === "1";
}

function dbg(...args) {
  if (isDebug()) console.log("[saveLog]", ...args);
}

function waitMs(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, options = {}, retryCount = 2) {
  let lastError = null;

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      const res = await fetch(url, options);
      if (RETRYABLE_STATUS.has(res.status) && attempt < retryCount) {
        await waitMs(250 * (attempt + 1));
        continue;
      }
      return res;
    } catch (e) {
      lastError = e;
      if (attempt >= retryCount) break;
      await waitMs(250 * (attempt + 1));
    }
  }

  throw lastError || new Error("fetch failed");
}

async function runWithConcurrency(items, limit, worker) {
  const queue = Array.isArray(items) ? items : [];
  const workerCount = Math.max(1, Math.min(limit, queue.length || 1));
  let cursor = 0;

  const runners = Array.from({ length: workerCount }, async () => {
    while (cursor < queue.length) {
      const idx = cursor;
      cursor += 1;
      await worker(queue[idx], idx);
    }
  });

  await Promise.all(runners);
}

/* ---------------------------------------------------------
   saveLog（append / multi / json / replaceCsv）
   ★ fileName を追加（後方互換100%）
--------------------------------------------------------- */
export async function saveLog(
  payloadOrType,
  dateStr,
  jsonData,
  csvLine,
  replaceCsv = "",
  fileName = null   // ← ★ 新規追加（指定がなければ null）
) {
  let payload;

  if (typeof payloadOrType === "object") {
    payload = payloadOrType;
  } else {
    payload = {
      type: payloadOrType,
      dateStr,
      json: jsonData,
      csv: csvLine,
      replaceCsv,
      fileName   // ← ★ 追加
    };
  }

  dbg("=== saveLog START ===");
  dbg("payload:", payload);

  if (!payload.suppressModal) {
    showSaveModal("保存しています…");
  }

  return saveToS3(payload);
}

/* ---------------------------------------------------------
   saveToS3（append / multi / json / replaceCsv）
--------------------------------------------------------- */
async function saveToS3(payload) {
  dbg("=== saveToS3 START ===");

  const replaceCsv = typeof payload.replaceCsv === "string"
    ? payload.replaceCsv
    : "";

  /* ------------------------------
     append モード（CSV 1 行追加）
  ------------------------------ */
  if (payload.csv && replaceCsv === "") {
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

    if (payload.summary) {
      await recordMonthlyWorkEntries(payload.summary).catch(e => {
        console.warn("[saveLog] monthly work summary update failed:", e);
      });
    }

    dbg("=== saveToS3 END (append) ===");

    if (!payload.suppressModal) {
      completeSaveModal("保存が完了しました");
    }
    return;
  }

  /* ------------------------------
     multi モード（複数ファイル保存）
  ------------------------------ */
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
    if (replaceCsv !== "") {
      // ★ fileName が指定されていればそれを使う
      // ★ 指定されていなければ all.csv（後方互換）
      const fileName = payload.fileName || "all.csv";

      const key = `logs/${payload.type}/${fileName}`;
      dbg("CSV file:", key);

      files.push({
        key,
        content: replaceCsv,
        contentType: "application/octet-stream"
      });
    }
  }

  dbg("files to upload:", files);

  /* ------------------------------
     presign → PUT アップロード
     ファイルごとに独立なので並列化して待ち時間を短縮
  ------------------------------ */
  await runWithConcurrency(files, SAVE_UPLOAD_CONCURRENCY, async file => {
    dbg("---- presign request ----");
    dbg("key:", file.key);
    dbg("contentType:", file.contentType);

    const presignRes = await fetchWithRetry(PRESIGN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: file.key,
        contentType: file.contentType
      })
    }, 2);

    if (!presignRes.ok) {
      const body = await presignRes.text().catch(() => "");
      throw new Error(`presign failed: ${presignRes.status} ${body}`.trim());
    }

    const { url } = await presignRes.json();
    dbg("presigned URL:", url);

    dbg("---- PUT request ----");
    dbg("PUT to:", url);

    const putRes = await fetchWithRetry(url, {
      method: "PUT",
      body: file.content
    }, 1);

    dbg("PUT status:", putRes.status);

    if (!putRes.ok) {
      const text = await putRes.text();
      dbg("PUT failed body:", text);
      throw new Error("PUT failed: " + putRes.status);
    }
  });

  if (payload.summary) {
    await recordMonthlyWorkEntries(payload.summary).catch(e => {
      console.warn("[saveLog] monthly work summary update failed:", e);
    });
  }

  dbg("=== saveToS3 END ===");

  if (!payload.suppressModal) {
    completeSaveModal("保存が完了しました");
  }
}

/* ---------------------------------------------------------
   Content-Type 推定
--------------------------------------------------------- */
function guessType(path) {
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".csv")) return "application/octet-stream";
  return "text/plain";
}
