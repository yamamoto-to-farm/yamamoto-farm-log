import { clearSession, ensureToken } from "/photos/auth.js?v=20261029-2";

const apiBase = "https://8ifv43nb7l.execute-api.ap-northeast-1.amazonaws.com/settlements";
let nextRequestAt = 0;
let queue = Promise.resolve();

export function salesApi(path, body) {
  const task = queue.then(async () => {
    const token = await ensureToken();
    if (!token) throw new Error("Cognitoに再ログインしてください。");
    for (let attempt = 0; attempt < 3; attempt++) {
      const delay = Math.max(0, nextRequestAt - Date.now());
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      nextRequestAt = Date.now() + 10500;
      const result = await fetch(`${apiBase}${path}`, {
        method: body === undefined ? "GET" : "POST", cache: "no-store",
        headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (result.status === 429 && attempt < 2) continue;
      if (result.status === 401) clearSession();
      if (result.status === 401 || result.status === 403) {
        const error = new Error(result.status === 401 ? "Cognitoに再ログインしてください。" : "売上情報はCognitoのadmin / familyのみ利用できます。");
        error.status = result.status;
        throw error;
      }
      if (!result.ok) {
        let detail = "";
        const text = await result.text();
        try {
          const value = JSON.parse(text);
          if (typeof value.message === "string") detail = ` ${value.message}`;
        } catch (error) {
          if (!(error instanceof SyntaxError)) throw error;
        }
        throw new Error(`売上APIの処理に失敗しました（${result.status}）。${detail}`);
      }
      return result.json();
    }
    throw new Error("APIの利用制限に達しました。しばらく待ってから再実行してください。");
  });
  queue = task.then(() => undefined, () => undefined);
  return task;
}

export async function openSettlementPdf(date, number) {
  const popup = window.open("about:blank", "_blank");
  if (!popup) throw new Error("通知書を開けません。ポップアップを許可してください。");
  popup.opener = null;
  try {
    const query = new URLSearchParams({ date, number });
    const data = await salesApi(`/pdf?${query}`);
    const url = new URL(data.url);
    if (url.protocol !== "https:" || url.username || url.password ||
        !/^yamamoto-farm-private-finance-01\.s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/.test(url.hostname)) {
      throw new Error("通知書のURLを確認できません。");
    }
    popup.location.replace(url.href);
  } catch (error) {
    popup.close();
    throw error;
  }
}
