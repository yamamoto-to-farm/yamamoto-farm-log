// /common/save/index.js

import { getFileSha, putFile } from "./github.js";

// JSON保存（1日1ファイル）
async function saveJson(type, dateStr, jsonData) {
  const path = `${type}/${dateStr}.json`;
  const sha = await getFileSha(path);

  return putFile(
    path,
    JSON.stringify(jsonData, null, 2),
    `add ${type}/${dateStr}.json`,
    sha
  );
}

// CSV保存（all.csv に1行追加）
async function appendCsv(type, csvLine) {
  const path = `${type}/all.csv`;

  // 既存CSV取得
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${TOKEN}` }
  });

  let oldCsv = "";
  let sha = null;

  if (res.status === 200) {
    const data = await res.json();
    sha = data.sha;
    oldCsv = decodeURIComponent(escape(atob(data.content)));
  }

  const newCsv = oldCsv + csvLine + "\n";

  return putFile(path, newCsv, `append ${type} log`, sha);
}

// 共通保存関数（すべての作業ログがこれを使う）
export async function saveLog(type, dateStr, jsonData, csvLine) {
  await saveJson(type, dateStr, jsonData);
  await appendCsv(type, csvLine);
}