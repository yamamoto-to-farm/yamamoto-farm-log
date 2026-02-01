export async function saveLog(type, dateStr, jsonData, csvLine) {
  const payload = { type, dateStr, json: jsonData, csv: csvLine };

  const res = await fetch("https://raspy-poetry-cf6f.yamamoto-to-farm.workers.dev", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    throw new Error("保存サーバーへの送信に失敗");
  }
}