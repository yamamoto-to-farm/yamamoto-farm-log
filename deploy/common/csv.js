// =========================================================
// common/csv.js — CloudFront + S3 時代の CSV 読み込み専用
// =========================================================

// ★ CloudFront のベース URL（あなたの環境に合わせて固定）
const CF_BASE = "https://d3sscxnlo0qnhe.cloudfront.net";

// ---------------------------------------------------------
// normalizeKeys（CSV のキーと値を整形）
// ---------------------------------------------------------
export function normalizeKeys(rows) {
  return rows.map(row => {
    const fixed = {};
    Object.keys(row).forEach(k => {
      const key = k.trim();
      const val = (typeof row[k] === "string") ? row[k].trim() : row[k];
      fixed[key] = val;
    });
    return fixed;
  });
}

// ---------------------------------------------------------
// CSV 読み込み（CloudFront → S3）
// ---------------------------------------------------------
export async function loadCSV(path) {
  // 先頭が "/" の場合は CloudFront 絶対パスに変換
  let url = path.startsWith("/")
    ? `${CF_BASE}${path}`
    : `${CF_BASE}/${path}`;

  // キャッシュ破棄（常に最新を読む）
  url += `?ts=${Date.now()}`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    console.error("[loadCSV] fetch failed:", url, res.status);
    throw new Error("CSV fetch failed: " + url);
  }

  const text = await res.text();
  const normalized = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const lines = normalized
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);

  if (lines.length === 0 || !lines[0].trim()) return [];

  const headers = parseCsvLine(lines[0]).map((h, i) => {
    const head = String(h || "").trim();
    return i === 0 ? head.replace(/^\uFEFF/, "") : head;
  });

  return lines.slice(1).map(line => {
    const cols = parseCsvLine(line);
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = String(cols[i] ?? "");
    });
    return obj;
  });
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }

    cur += ch;
  }

  out.push(cur);
  return out;
}

// ---------------------------------------------------------
// appendCSV はもう使わない（append API に完全移行）
// ---------------------------------------------------------
export async function appendCSV() {
  throw new Error("appendCSV は使用禁止：append API を使ってください");
}
