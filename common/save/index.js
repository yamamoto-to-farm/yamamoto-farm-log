// /common/save/index.js
// GitHub Actions 保存方式：UI は issue を作るだけ

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

  const res = await fetch(
    "https://api.github.com/repos/yamamoto-to-farm/yamamoto-farm-log/issues",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        title: issueTitle,
        body: issueBody
      })
    }
  );

  if (!res.ok) {
    const msg = await res.text();
    throw new Error("Issue 作成に失敗: " + msg);
  }
}