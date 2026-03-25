// =========================================================
// common/json.js — CloudFront + saveJSON API 対応版
// =========================================================

// ★ CloudFront のベース URL（あなたの環境に合わせて固定）
const CF_BASE = "https://d3sscxnlo0qnhe.cloudfront.net";

// ---------------------------------------------------------
// JSON 読み込み（CloudFront → S3）
// ---------------------------------------------------------
export async function loadJSON(path) {
  // 先頭が "/" の場合は CloudFront 絶対パスに変換
  let url = path.startsWith("/")
    ? `${CF_BASE}${path}`
    : `${CF_BASE}/${path}`;

  // キャッシュ破棄
  url += `?ts=${Date.now()}`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    console.error("[loadJSON] fetch failed:", url, res.status);
    throw new Error("JSON fetch failed: " + url);
  }

  return await res.json();
}

// ---------------------------------------------------------
// JSON 保存（saveJSON API）
// ---------------------------------------------------------
export async function saveJSON(path, jsonObj) {
  const url = "https://whc3hq3yq6.execute-api.ap-northeast-1.amazonaws.com/prod/save-json";

  const body = {
    path: path,
    content: JSON.stringify(jsonObj)
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  // ★ HTTP レベルで失敗していないかチェック
  if (!res.ok) {
    throw new Error("saveJSON failed (HTTP): " + res.status);
  }

  // ★ body は文字列 JSON の場合があるので text() で受ける
  const text = await res.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = {};
  }

  // ★ Lambda のレスポンスは { ok: true } が body に入っている
  //   ただし data.ok が undefined でも HTTP 200 なら成功扱いにする
  if (data.ok === false) {
    throw new Error("saveJSON failed: " + text);
  }

  // ★ ここまで来たら成功
  return true;
}