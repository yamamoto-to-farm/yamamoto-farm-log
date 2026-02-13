// common/github.js

// ★ 必ず自分のリポジトリ情報に書き換える
const OWNER = "yamamoto-to-farm";
const REPO  = "yamamoto-farm-log";
const BRANCH = "main";

// ★ GitHub Token は script タグで window.GITHUB_TOKEN として渡す前提
const TOKEN = window.GITHUB_TOKEN;

// --------------------------------------
// GitHub GET（ファイル読み込み）
// --------------------------------------
async function githubGet(path) {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}?ref=${BRANCH}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error("GitHub GET failed: " + path);

  return res.json();
}

// --------------------------------------
// GitHub PUT（ファイル書き込み）
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
  const data = await githubGet(path);
  return decodeURIComponent(escape(atob(data.content)));
}

// --------------------------------------
// 公開関数：テキスト上書き
// --------------------------------------
export async function writeText(path, text) {
  const data = await githubGet(path);
  return githubPut(path, text, data.sha);
}

// --------------------------------------
// 公開関数：テキスト追記
// --------------------------------------
export async function appendText(path, text) {
  const old = await readText(path);
  const updated = old + text;
  return writeText(path, updated);
}