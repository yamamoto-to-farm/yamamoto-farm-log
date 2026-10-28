import { config } from "./config.js";

const SESSION = "farm-photo-session";
const TRANSACTION = "farm-photo-login";

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function clearSession() {
  localStorage.removeItem(SESSION);
}

function readSession() {
  try {
    const session = JSON.parse(localStorage.getItem(SESSION));
    return session && typeof session.refreshToken === "string" ? session : null;
  } catch (error) {
    return null;
  }
}

export function hasSession() {
  return !!readSession();
}

export function getToken() {
  const session = readSession();
  if (!session || Date.now() >= session.expiresAt - 30000) return null;
  return session.accessToken;
}

let refreshing = null;

async function refreshSession(session) {
  const response = await fetch(`${config.domain}/oauth2/token`, {
    method: "POST", cache: "no-store",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token", client_id: config.clientId, refresh_token: session.refreshToken
    })
  });
  if (response.status === 400 || response.status === 401) {
    clearSession();
    return null;
  }
  if (!response.ok) throw new Error(`ログインの更新に失敗しました（${response.status}）。`);
  const token = await response.json();
  if (typeof token.access_token !== "string" || !Number.isFinite(token.expires_in) || token.expires_in <= 0) {
    throw new Error("認証サーバーの応答が不正です。");
  }
  localStorage.setItem(SESSION, JSON.stringify({
    accessToken: token.access_token, expiresAt: Date.now() + token.expires_in * 1000,
    refreshToken: session.refreshToken
  }));
  return token.access_token;
}

// 有効なアクセストークンを返す。期限切れならリフレッシュトークンで更新する。
export async function ensureToken() {
  const current = getToken();
  if (current) return current;
  const session = readSession();
  if (!session) return null;
  refreshing ||= refreshSession(session).finally(() => { refreshing = null; });
  return refreshing;
}

export async function login(field) {
  clearSession();
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const state = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  ));
  sessionStorage.setItem(TRANSACTION, JSON.stringify({ verifier, state, field, createdAt: Date.now() }));
  const url = new URL("/oauth2/authorize", config.domain);
  url.search = new URLSearchParams({
    client_id: config.clientId, redirect_uri: config.callback,
    response_type: "code", scope: "openid",
    state, code_challenge: challenge, code_challenge_method: "S256"
  });
  location.assign(url);
}

export async function finishLogin() {
  const params = new URLSearchParams(location.search);
  history.replaceState(null, "", location.pathname);
  const raw = sessionStorage.getItem(TRANSACTION);
  sessionStorage.removeItem(TRANSACTION);
  if (!raw) throw new Error("ログイン操作が見つかりません。写真ページからやり直してください。");
  const transaction = JSON.parse(raw);
  if (params.get("state") !== transaction.state || Date.now() - transaction.createdAt > 600000) {
    throw new Error("ログイン確認情報が不正または期限切れです。やり直してください。");
  }
  if (params.has("error")) throw new Error("Cognitoでログインが完了しませんでした。やり直してください。");
  const code = params.get("code");
  if (!code) throw new Error("認証コードがありません。");
  const response = await fetch(`${config.domain}/oauth2/token`, {
    method: "POST", cache: "no-store",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code", client_id: config.clientId,
      redirect_uri: config.callback, code, code_verifier: transaction.verifier
    })
  });
  if (!response.ok) throw new Error(`ログイン確認に失敗しました（${response.status}）。`);
  const token = await response.json();
  if (token.token_type !== "Bearer" || typeof token.access_token !== "string" ||
      typeof token.refresh_token !== "string" ||
      !Number.isFinite(token.expires_in) || token.expires_in <= 0) {
    throw new Error("認証サーバーの応答が不正です。");
  }
  localStorage.setItem(SESSION, JSON.stringify({
    accessToken: token.access_token, expiresAt: Date.now() + token.expires_in * 1000,
    refreshToken: token.refresh_token
  }));
  const destination = new URL("/photos/index.html", location.origin);
  if (transaction.field) destination.searchParams.set("field", transaction.field);
  location.replace(destination);
}

export function logout() {
  clearSession();
  sessionStorage.removeItem(TRANSACTION);
  const url = new URL("/logout", config.domain);
  url.search = new URLSearchParams({ client_id: config.clientId, logout_uri: config.logout });
  location.assign(url);
}
