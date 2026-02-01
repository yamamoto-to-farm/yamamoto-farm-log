// /common/save/index.js
// UI → GitHub Actions (workflow_dispatch) に JSON を送るだけ

export async function saveLog(type, dateStr, jsonData, csvLine) {
  const payload = {
    type,
    dateStr,
    json: jsonData,
    csv: csvLine
  };

  const res = await fetch(
    "https://api.github.com/repos/yamamoto-to-farm/yamamoto-farm-log/actions/workflows/save.yml/dispatches",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // 認証不要 → GitHub Pages からの CORS も許可されている
      },
      body: JSON.stringify({
        ref: "main",
        inputs: {
          payload: JSON.stringify(payload)
        }
      })
    }
  );

  if (!res.ok) {
    const msg = await res.text();
    throw new Error("workflow_dispatch に失敗: " + msg);
  }
}