// =========================================================
// common/csv.js — CloudFront + S3 時代の CSV 読み込み専用
// =========================================================

// ★ CloudFront のベース URL（あなたの環境に合わせて固定）
const CF_BASE = "https://d3sscxnlo0qnhe.cloudfront.net";

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

  const lines = text.trim().split("\n");
  const headers = lines[0].split(",");

  return lines.slice(1).map(line => {
    const cols = line.split(",");
    const obj = {};
    headers.forEach((h, i) => obj[h] = cols[i]);
    return obj;
  });
}

// ---------------------------------------------------------
// appendCSV はもう使わない（append API に完全移行）
// ---------------------------------------------------------
export async function appendCSV() {
  throw new Error("appendCSV は使用禁止：append API を使ってください");
}