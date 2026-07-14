// ===============================
// import（必ずファイル先頭）
// ===============================
import { getCurrentPosition, getNearestField } from "./app.js";
import { openWorkerSelectModal } from "./filter/filter-worker.js";
import { loadCSV } from "./csv.js";
import { loadJSON, saveJSON } from "./json.js";
import { saveLog } from "./save/index.js";


// ===============================
// デバッグモード（true で有効）
// ===============================
const DEBUG_MODE = false;
const AUTH_STATE_PATH = "/data/auth-state.json";
const AUTH_CONFIG_PATH = "/data/auth-config.json";
const DEFAULT_AUTH_CONFIG = {
  sessionTtlMs: 8 * 60 * 60 * 1000,
  heartbeatMs: 5 * 60 * 1000,
  idleTimeoutMs: 60 * 60 * 1000,
  stepupTtlMs: 30 * 60 * 1000,
  sensitivePathPrefixes: ["/admin/"]
};
const AUTH_SESSION_KEY = "authSessionId";
const AUTH_ISSUED_KEY = "authIssuedAt";
const AUTH_EXPIRES_KEY = "authExpiresAt";
const AUTH_VERSION_KEY = "authVersion";
const AUTH_HUMAN_KEY = "human";
const AUTH_ROLE_KEY = "role";
const AUTH_LAST_ACTIVE_KEY = "authLastActiveAt";
const AUTH_STEPUP_AT_KEY = "authStepupAt";

let authHeartbeatStarted = false;
let authActivityBound = false;
let authConfigCache = null;

// ===============================
// デバッグ表示用UI（自動生成）
// ===============================
function debugLog(msg) {
  if (!DEBUG_MODE) return;

  let box = document.getElementById("debug");
  if (!box) {
    box = document.createElement("div");
    box.id = "debug";
    box.style.position = "fixed";
    box.style.bottom = "0";
    box.style.left = "0";
    box.style.right = "0";
    box.style.background = "rgba(0,0,0,0.75)";
    box.style.color = "#fff";
    box.style.fontSize = "12px";
    box.style.padding = "6px 10px";
    box.style.zIndex = "9999";
    box.style.whiteSpace = "pre-line";
    document.body.appendChild(box);
  }

  box.textContent = msg;
}

function nowIso() {
  return new Date().toISOString();
}

function nowMs() {
  return Date.now();
}

function normalizeMs(value, fallbackMs, minMs = 60 * 1000) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallbackMs;
  return Math.max(minMs, Math.floor(n));
}

function normalizePathPrefixes(list) {
  if (!Array.isArray(list)) return [...DEFAULT_AUTH_CONFIG.sensitivePathPrefixes];

  const normalized = list
    .map(v => String(v || "").trim())
    .filter(Boolean)
    .filter(v => v.startsWith("/"));

  return normalized.length ? [...new Set(normalized)] : [...DEFAULT_AUTH_CONFIG.sensitivePathPrefixes];
}

function normalizeAuthConfig(raw) {
  return {
    sessionTtlMs: normalizeMs(raw?.sessionTtlMs, DEFAULT_AUTH_CONFIG.sessionTtlMs),
    heartbeatMs: normalizeMs(raw?.heartbeatMs, DEFAULT_AUTH_CONFIG.heartbeatMs),
    idleTimeoutMs: normalizeMs(raw?.idleTimeoutMs, DEFAULT_AUTH_CONFIG.idleTimeoutMs),
    stepupTtlMs: normalizeMs(raw?.stepupTtlMs, DEFAULT_AUTH_CONFIG.stepupTtlMs),
    sensitivePathPrefixes: normalizePathPrefixes(raw?.sensitivePathPrefixes)
  };
}

async function ensureAuthConfigLoaded() {
  if (authConfigCache) return authConfigCache;

  try {
    const raw = await loadJSON(AUTH_CONFIG_PATH);
    authConfigCache = normalizeAuthConfig(raw);
  } catch {
    authConfigCache = { ...DEFAULT_AUTH_CONFIG };
  }

  return authConfigCache;
}

function isSensitivePath(pathname = location.pathname, sensitivePathPrefixes = DEFAULT_AUTH_CONFIG.sensitivePathPrefixes) {
  return sensitivePathPrefixes.some(prefix => pathname.startsWith(prefix));
}

function touchAuthActivity() {
  const role = localStorage.getItem(AUTH_ROLE_KEY);
  const human = localStorage.getItem(AUTH_HUMAN_KEY);
  if (!role || !human) return;

  localStorage.setItem(AUTH_LAST_ACTIVE_KEY, String(nowMs()));
}

function bindAuthActivityTracking() {
  if (authActivityBound) return;
  authActivityBound = true;

  let lastTouch = 0;
  const onActivity = () => {
    const t = nowMs();
    if (t - lastTouch < 5000) return;
    lastTouch = t;
    touchAuthActivity();
  };

  ["pointerdown", "keydown", "touchstart"].forEach(type => {
    window.addEventListener(type, onActivity, true);
  });
}

function csvCell(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

const SECURITY_LOG_COLUMNS = [
  "timestamp",
  "event",
  "human",
  "role",
  "sessionId",
  "detail",
  "path"
];

function buildSecurityCsv(rows) {
  const body = rows.map(row => {
    return SECURITY_LOG_COLUMNS.map(key => csvCell(row[key])).join(",");
  }).join("\n");

  return [SECURITY_LOG_COLUMNS.join(","), body].filter(Boolean).join("\n") + "\n";
}

async function loadAuthState() {
  try {
    const state = await loadJSON(AUTH_STATE_PATH);
    return {
      authVersion: Number(state?.authVersion || 1),
      updatedAt: state?.updatedAt || ""
    };
  } catch {
    return {
      authVersion: 1,
      updatedAt: ""
    };
  }
}

async function saveAuthState(state) {
  await saveJSON("data/auth-state.json", state);
}

async function appendSecurityAudit(event, detail = "") {
  try {
    let rows = [];
    try {
      rows = await loadCSV("/logs/security/all.csv");
    } catch {
      rows = [];
    }

    rows.push({
      timestamp: nowIso(),
      event,
      human: window.currentHuman || localStorage.getItem(AUTH_HUMAN_KEY) || "",
      role: window.currentRole || localStorage.getItem(AUTH_ROLE_KEY) || "",
      sessionId: localStorage.getItem(AUTH_SESSION_KEY) || "",
      detail,
      path: location.pathname
    });

    await saveLog({
      type: "security",
      replaceCsv: buildSecurityCsv(rows),
      fileName: "all.csv",
      suppressModal: true
    });
  } catch (e) {
    console.warn("[auth] security audit failed:", e);
  }
}

function clearAuthStorage() {
  localStorage.removeItem(AUTH_HUMAN_KEY);
  localStorage.removeItem(AUTH_ROLE_KEY);
  localStorage.removeItem(AUTH_SESSION_KEY);
  localStorage.removeItem(AUTH_ISSUED_KEY);
  localStorage.removeItem(AUTH_EXPIRES_KEY);
  localStorage.removeItem(AUTH_VERSION_KEY);
  localStorage.removeItem(AUTH_LAST_ACTIVE_KEY);
  localStorage.removeItem(AUTH_STEPUP_AT_KEY);
  window.currentHuman = "";
  window.currentRole = "";
}

function redirectWithReturnUrl(target = location.href) {
  sessionStorage.setItem("pendingReturnUrl", target);
  location.href = "/index.html";
}

async function startAuthHeartbeat() {
  if (authHeartbeatStarted) return;
  authHeartbeatStarted = true;
  const authConfig = await ensureAuthConfigLoaded();

  const tick = async () => {
    if (location.pathname === "/" || location.pathname === "/index.html") return;

    const ok = await verifyLocalAuth({ silent: true, source: "heartbeat" });
    if (!ok) return;
  };

  setInterval(tick, authConfig.heartbeatMs);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      void tick();
    }
  });
}

async function issueAuthSession(user) {
  const authConfig = await ensureAuthConfigLoaded();
  const authState = await loadAuthState();
  const now = nowMs();
  const sessionId = (crypto?.randomUUID?.() || `sess-${now}-${Math.random().toString(36).slice(2)}`);
  const expiresAt = now + authConfig.sessionTtlMs;

  localStorage.setItem(AUTH_HUMAN_KEY, user.name);
  localStorage.setItem(AUTH_ROLE_KEY, user.role);
  localStorage.setItem(AUTH_SESSION_KEY, sessionId);
  localStorage.setItem(AUTH_ISSUED_KEY, String(now));
  localStorage.setItem(AUTH_EXPIRES_KEY, String(expiresAt));
  localStorage.setItem(AUTH_VERSION_KEY, String(authState.authVersion));
  localStorage.setItem(AUTH_LAST_ACTIVE_KEY, String(now));
  localStorage.setItem(AUTH_STEPUP_AT_KEY, String(now));

  window.currentHuman = user.name;
  window.currentRole = user.role;

  await appendSecurityAudit("login", `sessionVersion=${authState.authVersion}`);
}

export async function logoutAndRedirect(reason = "logout") {
  await appendSecurityAudit(reason, "manual");

  if (location.pathname !== "/" && location.pathname !== "/index.html") {
    sessionStorage.setItem("pendingReturnUrl", location.href);
  } else {
    sessionStorage.removeItem("pendingReturnUrl");
  }

  clearAuthStorage();
  location.href = "/index.html";
}

export async function bumpAuthVersion(reason = "workers-updated") {
  const authState = await loadAuthState();
  const nextState = {
    authVersion: Number(authState.authVersion || 1) + 1,
    updatedAt: nowIso()
  };

  await saveAuthState(nextState);
  await appendSecurityAudit("revoke-all", `${reason};authVersion=${nextState.authVersion}`);
  return nextState;
}


// ===============================
// 圃場セレクタ（エリア → 圃場名）
// ===============================
export async function createFieldSelector(autoId, areaId, manualId) {

  // ▼ fields.json 読み込み
  const res = await fetch("/data/fields.json");
  const fields = await res.json();

  // 自動判定欄（読み取り専用）
  const auto = document.getElementById(autoId);
  auto.readOnly = true;

  // ▼ エリア一覧を抽出
  const areaSel = document.getElementById(areaId);
  const areas = [...new Set(fields.map(f => f.area))];

  areas.forEach(area => {
    const opt = document.createElement("option");
    opt.value = area;          // ← area 名
    opt.textContent = area;
    areaSel.appendChild(opt);
  });

  // ▼ 圃場セレクタ（手動）
  const fieldSel = document.getElementById(manualId);
  fieldSel.innerHTML = `<option value="">エリアを選んでください</option>`;

  // ▼ エリア選択時に圃場を絞り込み
  areaSel.addEventListener("change", () => {
    const selectedArea = areaSel.value;

    fieldSel.innerHTML = "";

    if (!selectedArea) {
      fieldSel.innerHTML = `<option value="">エリアを選んでください</option>`;
      return;
    }

    const filtered = fields.filter(f => f.area === selectedArea);

    filtered.forEach(f => {
      const opt = document.createElement("option");
      opt.value = f.name;     // ★ ここを id → name に変更
      opt.textContent = f.name;
      fieldSel.appendChild(opt);
    });
  });

  return fields;
}

// ===============================
// 品種セレクタ
// ===============================
async function setupVarietySelector() {
  const res = await fetch("../data/varieties.json");
  VARIETY_LIST = await res.json();

  const typeSel = document.getElementById("varietyType");
  const nameSel = document.getElementById("variety");

  const types = [...new Set(VARIETY_LIST.map(v => v.type))];
  types.forEach(t => {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = t;
    typeSel.appendChild(opt);
  });

  typeSel.addEventListener("change", () => {
    const selectedType = typeSel.value;
    nameSel.innerHTML = "<option value=''>品名を選択</option>";

    if (!selectedType) return;

    const filtered = VARIETY_LIST.filter(v => v.type === selectedType);

    filtered.forEach(v => {
      const opt = document.createElement("option");
      opt.value = v.name;      // ← name ベース
      opt.textContent = v.name;
      nameSel.appendChild(opt);
    });
  });
}

// ===============================
// GPS → エリア → 圃場 自動連動（nameベース版）
// ===============================
export async function autoDetectField(autoId, areaId, manualId) {

  const auto = document.getElementById(autoId);
  const areaSel = document.getElementById(areaId);
  const fieldSel = document.getElementById(manualId);

  auto.value = "GPS取得中…";
  debugLog("GPS取得中…");

  try {
    const pos = await getCurrentPosition(15000);
    const { lat, lng, accuracy } = pos;

    debugLog(
      `GPS取得成功
lat: ${lat}
lng: ${lng}
accuracy: ±${accuracy}m`
    );

    const nearest = await getNearestField(lat, lng);

    const distText =
      nearest.distance != null
        ? `\n距離: ${nearest.distance.toFixed(1)}m`
        : "";

    debugLog(
      `GPS取得成功
lat: ${lat}
lng: ${lng}
accuracy: ±${accuracy}m

最寄り圃場: ${nearest.name}${distText}`
    );

    // ▼ 自動判定欄に name を表示
    auto.value = `${nearest.name}（推定）`;

    // ▼ エリアをセット
    areaSel.value = nearest.area;
    areaSel.dispatchEvent(new Event("change"));

    // ▼ 圃場セレクタも name をセット（id → name に変更）
    fieldSel.value = nearest.name;

  } catch (err) {
    auto.value = "自動判定できませんでした（GPSエラー）";
    debugLog(`GPSエラー: ${err}`);
    console.error("GPSエラー:", err);
  }
}

// ===============================
// 作業者チェックボックス
// ===============================
export async function createWorkerCheckboxes(containerId) {

  const res = await fetch("/data/workers.json");
  const workers = await res.json();

  const box = document.getElementById(containerId);
  if (!box) return;

  // 互換: 既存画面の再描画時に中身を初期化
  box.innerHTML = "";

  // 既存選択値（あれば維持）
  const selected = readSelectedWorkers(box);

  // 既定選択: 未選択時はログイン中ユーザーを自動選択
  if (!selected.length) {
    const defaultWorker = resolveDefaultWorkerDisplay(workers);
    if (defaultWorker) selected.push(defaultWorker);
  }

  const summary = document.createElement("div");
  summary.className = "info-line";

  const openBtn = document.createElement("button");
  openBtn.type = "button";
  openBtn.className = "secondary-btn";
  openBtn.textContent = "作業者を選択";

  const selectedArea = document.createElement("div");
  selectedArea.className = "info-block";

  const renderSelected = () => {
    summary.textContent = "固定作業者";
    if (!selected.length) {
      selectedArea.textContent = "未選択";
      selectedArea.style.color = "#666";
    } else {
      selectedArea.textContent = selected.join(" / ");
      selectedArea.style.color = "#222";
    }
    writeSelectedWorkers(box, selected);
  };

  openBtn.addEventListener("click", () => {
    openWorkerSelectModal({
      workers,
      selected,
      onApply(next) {
        selected.length = 0;
        next.forEach(v => selected.push(v));
        renderSelected();
      }
    });
  });

  box.appendChild(summary);
  box.appendChild(openBtn);
  box.appendChild(selectedArea);
  renderSelected();
}

function resolveDefaultWorkerDisplay(workers) {
  const current = String(window.currentHuman || localStorage.getItem(AUTH_HUMAN_KEY) || "").trim();
  if (!current) return "";

  const list = Array.isArray(workers) ? workers : [];
  const hit = list.find(w => {
    const name = String(w?.name || "").trim();
    const display = String(w?.display || "").trim();
    return current === name || current === display;
  });

  return String(hit?.display || "").trim();
}

function readSelectedWorkers(box) {
  try {
    const raw = box?.dataset?.selectedWorkers;
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(v => typeof v === "string" && v.trim()).map(v => v.trim());
  } catch (e) {
    return [];
  }
}

function writeSelectedWorkers(box, selected) {
  box.dataset.selectedWorkers = JSON.stringify(selected || []);
}


// ===============================
// 作業者の取得（固定＋単発バイト）
// ===============================
export function getSelectedWorkers(boxId, tempId) {
  const box = document.getElementById(boxId);

  // 新方式: data-selected-workers（JSON配列）
  let fixed = readSelectedWorkers(box);

  // 後方互換: 旧チェックボックス方式
  if (!fixed.length) {
    fixed = [...document.querySelectorAll(`#${boxId} input[name='workers']:checked`)]
      .map(x => x.value);
  }

  const tempInput = document.getElementById(tempId);
  const temp = (tempInput?.value || "")
    .split(",")
    .map(x => x.trim())
    .filter(x => x);

  return [...new Set([...fixed, ...temp])].join(",");
}


// ===============================
// 日付入力コンポーネント
// ===============================
export function createDateInput(targetId, labelText = "") {
  const container = document.getElementById(targetId);

  const label = document.createElement("label");
  label.textContent = labelText;

  const input = document.createElement("input");
  input.type = "date";
  input.style.width = "100%";
  input.style.padding = "8px";
  input.style.fontSize = "16px";
  input.style.marginTop = "5px";

  container.appendChild(label);
  container.appendChild(input);

  return input;
}

// ===============================
// 圃場の最終決定ロジック（nameベース版）
// ===============================
export function getFinalField(
  autoId = "field_auto",
  manualId = "field_manual",
  confirmId = "field_confirm"
) {
  const rawAuto = document.getElementById(autoId)?.value || "";
  const manual = document.getElementById(manualId)?.value || "";
  const confirmed = document.getElementById(confirmId)?.checked;

  // ▼ auto の「（推定）」を除去して name だけにする
  const auto = rawAuto.replace(/（推定）/g, "").trim();

  // ▼ 優先順位：確認チェック → 手動 → 自動
  if (confirmed && auto) return auto;
  if (manual) return manual;
  return auto;
}

// ===============================
// PIN 認証 UI を表示し、認証後に callback を実行
// ===============================
export function showPinGate(containerId, onSuccess) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.style.display = "block";

  const input = document.getElementById("pin-input");
  const button = document.getElementById("pin-submit");

  if (!input || !button) {
    console.error("PIN UI が見つかりません");
    return;
  }

  async function authenticate() {
    const pin = input.value.trim();
    if (!pin) return;

    try {
      // workers.json を読み込む
      const resWorkers = await fetch("/data/workers.json?v=" + Date.now());
      const users = await resWorkers.json();

      // PIN 一致ユーザーを検索
      const user = users.find(u => u.pin === pin);

      if (!user) {
        alert("PIN が違います");
        return;
      }

      // 認証成功 → グローバル変数に保存
      await issueAuthSession(user);

      // PIN UI を非表示
      container.style.display = "none";

      // 認証後の処理
      if (onSuccess) onSuccess();

    } catch (e) {
      console.error("認証データ読み込みエラー:", e);
      alert("認証データの読み込みに失敗しました");
    }
  }

  // ボタン押下
  button.onclick = authenticate;

  // Enter キー対応
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") authenticate();
  });
}

// ===============================
// localStorage の認証情報がまだ有効かチェック
// ===============================
export async function verifyLocalAuth(options = {}) {
  const authConfig = await ensureAuthConfigLoaded();
  const savedHuman = localStorage.getItem(AUTH_HUMAN_KEY);
  const savedRole = localStorage.getItem(AUTH_ROLE_KEY);
  const savedIssuedAt = Number(localStorage.getItem(AUTH_ISSUED_KEY) || 0);
  const savedExpiresAt = Number(localStorage.getItem(AUTH_EXPIRES_KEY) || 0);
  const savedVersion = Number(localStorage.getItem(AUTH_VERSION_KEY) || 0);
  const savedLastActiveAt = Number(localStorage.getItem(AUTH_LAST_ACTIVE_KEY) || 0);
  const savedStepupAt = Number(localStorage.getItem(AUTH_STEPUP_AT_KEY) || 0);
  const shouldRedirect = !options?.noRedirect;

  // localStorage に何もない → index に戻す
  if (!savedHuman || !savedRole) {
    if (shouldRedirect) redirectWithReturnUrl();
    return false;
  }

  try {
    const authState = await loadAuthState();

    const computedExpiresAt = savedIssuedAt ? (savedIssuedAt + authConfig.sessionTtlMs) : 0;
    const effectiveExpiresAt = savedExpiresAt && computedExpiresAt
      ? Math.min(savedExpiresAt, computedExpiresAt)
      : (savedExpiresAt || computedExpiresAt);

    if (effectiveExpiresAt && Date.now() > effectiveExpiresAt) {
      await appendSecurityAudit("expired", `issuedAt=${savedIssuedAt}`);
      clearAuthStorage();
      if (shouldRedirect) redirectWithReturnUrl();
      return false;
    }

    const lastActiveAt = savedLastActiveAt || savedIssuedAt;
    if (lastActiveAt && nowMs() - lastActiveAt > authConfig.idleTimeoutMs) {
      await appendSecurityAudit("expired", `idle-timeout:${authConfig.idleTimeoutMs}`);
      clearAuthStorage();
      if (shouldRedirect) redirectWithReturnUrl();
      return false;
    }

    // ★ AWS では絶対ルートパスが正解
    const res = await fetch("/data/workers.json?v=" + Date.now());
    const users = await res.json();

    // localStorage の情報が workers.json に存在するか確認
    const user = users.find(u => u.name === savedHuman && u.role === savedRole);

    if (!user) {
      // 退職者 or 削除されたユーザー
      await appendSecurityAudit("revoked", "worker-missing");
      clearAuthStorage();
      if (!options?.silent) {
        alert("認証情報が無効になりました。再ログインしてください。");
      }
      if (shouldRedirect) redirectWithReturnUrl();
      return false;
    }

    if (savedVersion && savedVersion !== authState.authVersion) {
      await appendSecurityAudit("revoked", `version-mismatch:${savedVersion}->${authState.authVersion}`);
      clearAuthStorage();
      if (!options?.silent) {
        alert("ログイン状態が更新されました。再ログインしてください。");
      }
      if (shouldRedirect) redirectWithReturnUrl();
      return false;
    }

    if (
      savedRole === "admin" &&
      isSensitivePath(options?.path ?? location.pathname, authConfig.sensitivePathPrefixes) &&
      (!savedStepupAt || nowMs() - savedStepupAt > authConfig.stepupTtlMs)
    ) {
      await appendSecurityAudit("stepup-required", `path=${location.pathname}`);
      clearAuthStorage();
      if (!options?.silent) {
        alert("重要操作のため再認証してください。");
      }
      if (shouldRedirect) redirectWithReturnUrl();
      return false;
    }

    // 認証OK → グローバル変数に反映
    window.currentHuman = savedHuman;
    window.currentRole = savedRole;
    localStorage.setItem(AUTH_VERSION_KEY, String(authState.authVersion));
    localStorage.setItem(AUTH_LAST_ACTIVE_KEY, String(nowMs()));
    bindAuthActivityTracking();

    await startAuthHeartbeat();

    return true;

  } catch (e) {
    console.error("認証データ読み込みエラー:", e);
    alert("認証データの読み込みに失敗しました");
    return false;
  }
}



// ===============================
// ページ読み込み時に localStorage を検証
// （index 以外のページで利用）
// ===============================
window.addEventListener("DOMContentLoaded", async () => {

  // index.html では verifyLocalAuth を呼ばない
  if (location.pathname === "/" ||
    location.pathname === "/index.html") {
    return;
  }

  const ok = await verifyLocalAuth();
  if (!ok) return;

  // 認証OK → グローバル変数に反映（保険）
  window.currentRole = localStorage.getItem(AUTH_ROLE_KEY);
  window.currentHuman = localStorage.getItem(AUTH_HUMAN_KEY);
});
