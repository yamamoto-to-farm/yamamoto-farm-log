// =========================================================
// common/csv.js — CloudFront + S3 時代の CSV 読み込み専用
// =========================================================

// ★ CloudFront のベース URL（あなたの環境に合わせて固定）
const CF_BASE = "https://d3sscxnlo0qnhe.cloudfront.net";
const S3_BASE = "https://yamamoto-farm-log.s3.ap-northeast-1.amazonaws.com";

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

export function parseCsvText(text) {
  const normalized = String(text || "").replace(/^\uFEFF/, "").trim();
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
      obj[h] = normalizeCsvCell(cols[i]);
    });
    return obj;
  });
}

function normalizeCsvCell(value) {
  let text = String(value ?? "").trim();

  // Legacy seed CSV has memo values like """""" for blank and
  // """N60 ホワイトカリウ""" for text. Treat the outer quote marks as CSV noise.
  if (/^"+$/.test(text)) return "";
  while (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    text = text.slice(1, -1).trim();
    if (/^"+$/.test(text)) return "";
  }

  return text;
}

// ---------------------------------------------------------
// CSV 読み込み（CloudFront → S3）
// ---------------------------------------------------------
export async function loadCSV(path) {
  const normalizedPath = String(path || "").trim();
  const base = normalizedPath.replace(/^https?:\/\/[^/]+/, "").startsWith("/logs/")
    ? S3_BASE
    : CF_BASE;
  let url = /^https?:\/\//.test(normalizedPath)
    ? normalizedPath
    : `${base}${normalizedPath.startsWith("/") ? normalizedPath : `/${normalizedPath}`}`;

  // キャッシュ破棄（常に最新を読む）
  url += `?ts=${Date.now()}`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    console.error("[loadCSV] fetch failed:", url, res.status);
    throw new Error("CSV fetch failed: " + url);
  }

  const text = await res.text();
  return parseCsvText(text);
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
