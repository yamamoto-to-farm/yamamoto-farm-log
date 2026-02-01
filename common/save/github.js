// /common/save/github.js
import { TOKEN } from "https://raw.githubusercontent.com/yamamoto-to-farm/farm-secret-config/main/token.js";

const OWNER = "yamamoto-to-farm";
const REPO = "yamamoto-farm-data";
const BRANCH = "main";

// Base64
export function toBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

// GitHub API: ファイルのSHAを取得
export async function getFileSha(path) {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${TOKEN}` }
  });

  if (res.status === 404) return null;

  const data = await res.json();
  return data.sha;
}

// GitHub API: ファイル保存（PUT）
export async function putFile(path, content, message, sha = null) {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`;

  const body = {
    message,
    content: toBase64(content),
    branch: BRANCH
  };

  if (sha) body.sha = sha;

  return fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
}