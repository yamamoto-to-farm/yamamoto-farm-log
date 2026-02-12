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

export async function saveRawFile(path, content) {
  const token = localStorage.getItem("github_token");
  if (!token) {
    alert("GitHub トークンが設定されていません");
    return;
  }

  // ★ これが必要（あなたの環境に合わせて固定）
  const OWNER = "yamamoto-to-farm";
  const REPO = "yamamoto-farm-log";


  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`;

  // 既存ファイルの SHA を取得
  const res = await fetch(url);
  const info = await res.json();

  const body = {
    message: `update ${path}`,
    content: btoa(unescape(encodeURIComponent(content))),
    sha: info.sha
  };

  await fetch(url, {
    method: "PUT",
    headers: {
      "Authorization": `token ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
}