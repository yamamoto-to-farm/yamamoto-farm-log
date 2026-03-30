// notes.js（完全修正版・デバッグ切替付き）
const CF_BASE = "https://d3sscxnlo0qnhe.cloudfront.net";

// ★ デバッグフラグ（true でログ出る）
const DEBUG = true;

/* ===============================
   安全な CSV 1行パース（カンマ対応）
=============================== */
function parseCSVLine(line) {
  const result = [];
  let current = "";
  let insideQuote = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];

    if (c === '"') {
      insideQuote = !insideQuote;
    } else if (c === "," && !insideQuote) {
      result.push(current);
      current = "";
    } else {
      current += c;
    }
  }
  result.push(current);
  return result;
}

/* ===============================
   CSV 全体を読み込んで配列に変換
=============================== */
async function fetchCSV(path) {
  const url = `${CF_BASE}/${path}?ts=${Date.now()}`;

  if (DEBUG) {
    console.log("=== fetchCSV ===");
    console.log("URL:", url);
  }

  const text = await fetch(url).then(r => r.text());

  if (DEBUG) {
    console.log("RAW CSV (first 200 chars):", text.slice(0, 200));
  }

  const lines = text.trim().split("\n");

  // ★ ヘッダーを安全にパース & trim() で \r を除去
  const headers = parseCSVLine(lines[0]).map(h => h.trim());

  if (DEBUG) {
    console.log("HEADERS:", headers);
  }

  const rows = lines.slice(1).map(line => {
    const cols = parseCSVLine(line);
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = cols[i] ?? "";
    });
    return obj;
  });

  if (DEBUG) {
    console.log("ROWS LOADED:", rows.length);
  }

  return rows;
}

/* ===============================
   note 抽出ロジック（メイン）
=============================== */
export async function loadNotesForPlantingRef(plantingRef) {
  if (DEBUG) {
    console.log("=== loadNotesForPlantingRef START ===");
    console.log("TARGET plantingRef:", plantingRef);
  }

  const sources = [
    { file: "logs/planting/all.csv", tag: "【定植】" },

    // { file: "logs/cultivation/all.csv", tag: "【中耕】" },
    // { file: "logs/fertilizer/all.csv",  tag: "【施肥】" },
    // { file: "logs/pesticide/all.csv",   tag: "【防除】" },

    { file: "logs/harvest/all.csv", tag: "【収穫】" },
    { file: "logs/weight/all.csv",  tag: "【出荷】" }
  ];

  let notes = [];

  for (const src of sources) {
    if (DEBUG) console.log("---- Checking:", src.file);

    try {
      const rows = await fetchCSV(src.file);

      for (const row of rows) {
        const rowRef = row.plantingRef?.trim();

        // plantingRef が一致する行だけログ
        if (DEBUG && rowRef === plantingRef) {
          console.log("MATCH FOUND:", row);
        }

        // note カラム名の候補
        const noteValue =
          row.note ??
          row.notes ??
          row.memo ??
          row.comment ??
          "";

        if (rowRef === plantingRef && noteValue.trim() !== "") {
          if (DEBUG) console.log("NOTE FOUND:", noteValue);
          notes.push(`${src.tag}${noteValue.trim()}`);
        }
      }

    } catch (e) {
      console.warn(`ERROR reading ${src.file}:`, e);
    }
  }

  if (DEBUG) {
    console.log("=== FINAL NOTES ===", notes);
  }

  return notes;
}