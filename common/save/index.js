// common/saveLog.js

export async function saveLog(
  type,
  dateStr,
  jsonData,
  csvLine,
  replaceCsv = ""   // ← 新しく追加（既存コードはここを渡さないので壊れない）
) {
  const payload = {
    type,
    dateStr,
    json: jsonData,
    csv: csvLine,
    replaceCsv   // ← 管理画面から来たときだけ値が入る
  };

  const res = await fetch(
    "https://raspy-poetry-cf6f.yamamoto-to-farm.workers.dev",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }
  );

  if (!res.ok) {
    throw new Error("保存サーバーへの送信に失敗");
  }
}