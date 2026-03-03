// common/github.js

// ★ 自分のリポジトリ情報
const OWNER = "yamamoto-to-farm";
const REPO  = "yamamoto-farm-log";
const BRANCH = "main";

// ★ GitHub Token（保存時のみ使用）
const TOKEN = window.GITHUB_TOKEN;

// --------------------------------------
// GitHub GET（ファイル読み込み）
// → raw.githubusercontent.com に変更（403対策）
// --------------------------------------
async function githubGet(path) {
  // ★ API ではなく raw を使う
  const url = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/${path}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error("GitHub GET failed: " + path);

  // raw は base64 ではなく「そのままテキスト」
  return res.text();
}

// --------------------------------------
// GitHub PUT（ファイル書き込み）
// → API を使う（従来通り）
// --------------------------------------
async function githubPut(path, content, sha) {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`;

  const body = {
    message: `update ${path}`,
    content: btoa(unescape(encodeURIComponent(content))),
    sha,
    branch: BRANCH
  };

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Authorization": `token ${TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) throw new Error("GitHub PUT failed: " + path);

  return res.json();
}

// --------------------------------------
// 公開関数：テキスト読み込み
// --------------------------------------
export async function readText(path) {
  // ★ raw からそのままテキストが返る
  return githubGet(path);
}

// --------------------------------------
// 公開関数：テキスト上書き
// --------------------------------------
export async function writeText(path, text) {
  // ★ sha を取得するためだけに API を使う
  const metaUrl = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}?ref=${BRANCH}`;
  const metaRes = await fetch(metaUrl);
  if (!metaRes.ok) throw new Error("GitHub GET (meta) failed: " + path);
  const meta = await metaRes.json();

  return githubPut(path, text, meta.sha);
}

// --------------------------------------
// 公開関数：テキスト追記
// --------------------------------------
export async function appendText(path, text) {
  const old = await readText(path);
  const updated = old + text;
  return writeText(path, updated);
}