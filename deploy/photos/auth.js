import { config } from "./config.js";

const SESSION = "farm-photo-session";
const TRANSACTION = "farm-photo-login";

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function clearSession() {
  sessionStorage.removeItem(SESSION);
}

export function getToken() {
  const raw = sessionStorage.getItem(SESSION);
  if (!raw) return null;
  const session = JSON.parse(raw);
  if (Date.now() >= session.expiresAt - 30000) {
    clearSession();
    return null;
  }
  return session.accessToken;
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
    response_type: "code", scope: "openid email",
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
      !Number.isFinite(token.expires_in) || token.expires_in <= 0) {
    throw new Error("認証サーバーの応答が不正です。");
  }
  sessionStorage.setItem(SESSION, JSON.stringify({
    accessToken: token.access_token, expiresAt: Date.now() + token.expires_in * 1000
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
