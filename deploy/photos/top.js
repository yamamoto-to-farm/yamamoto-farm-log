import { config } from "./config.js";
import { clearSession, ensureToken } from "./auth.js";

// 圃場のトップ写真を取得する。未設定・未ログインなら null。
export async function fetchTopPhoto(field) {
  const token = await ensureToken();
  if (!token) return null;
  const response = await fetch(`${config.api}/photos/top?${new URLSearchParams({ field })}`, {
    cache: "no-store", headers: { Authorization: `Bearer ${token}` }
  });
  if (response.status === 401) {
    clearSession();
    return null;
  }
  if (!response.ok) throw new Error(`トップ写真を取得できません（${response.status}）。`);
  const result = await response.json();
  return result.photo || null;
}

export async function setTopPhoto(field, id) {
  const token = await ensureToken();
  if (!token) throw new Error("ログインが必要です。");
  const response = await fetch(`${config.api}/photos/top`, {
    method: "POST", cache: "no-store",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ field, id })
  });
  if (response.status === 403) throw new Error("トップ写真を設定する権限がありません。再ログインすると反映される場合があります。");
  if (!response.ok) throw new Error(`トップ写真を設定できません（${response.status}）。`);
}
