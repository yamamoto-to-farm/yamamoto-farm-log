// /common/save/index.js
// 認証不要で Issue を作る（GitHub Web UI のフォーム投稿を利用）

export async function saveLog(type, dateStr, jsonData, csvLine) {
  const issueTitle = `[${type}] ${dateStr}`;
  const issueBody = JSON.stringify(
    {
      type,
      dateStr,
      json: jsonData,
      csv: csvLine
    },
    null,
    2
  );

  const form = new URLSearchParams();
  form.append("title", issueTitle);
  form.append("body", issueBody);

  const res = await fetch(
    "https://github.com/yamamoto-to-farm/yamamoto-farm-log/issues/new",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: form.toString()
    }
  );

  if (!res.ok) {
    const msg = await res.text();
    throw new Error("Issue 作成に失敗: " + msg);
  }
}