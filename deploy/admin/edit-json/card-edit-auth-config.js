import { saveJSON } from "/common/json.js?v=1";
import { showSaveModal, completeSaveModal } from "/common/save-modal.js?v=1";

function toNumberOrFallback(value, fallback, min = 60000) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.floor(n));
}

function normalizePathPrefixes(text) {
  const values = String(text || "")
    .split(/\r?\n/)
    .map(v => v.trim())
    .filter(Boolean)
    .filter(v => v.startsWith("/"));

  return values.length ? [...new Set(values)] : ["/admin/"];
}

export function renderEditCard({ json, container }) {
  const title = document.getElementById("page-title");
  if (title) title.textContent = "認証設定（auth-config.json）";

  const current = {
    sessionTtlMs: toNumberOrFallback(json?.sessionTtlMs, 8 * 60 * 60 * 1000),
    heartbeatMs: toNumberOrFallback(json?.heartbeatMs, 5 * 60 * 1000),
    idleTimeoutMs: toNumberOrFallback(json?.idleTimeoutMs, 60 * 60 * 1000),
    stepupTtlMs: toNumberOrFallback(json?.stepupTtlMs, 30 * 60 * 1000),
    sensitivePathPrefixes: Array.isArray(json?.sensitivePathPrefixes)
      ? json.sensitivePathPrefixes
      : ["/admin/"]
  };

  container.insertAdjacentHTML("beforeend", `
    <div class="card">
      <h2>認証ポリシー</h2>
      <p style="margin:0 0 14px; color:#555;">
        セキュリティと使いやすさのバランスを調整する設定です。単位は「分」です。
      </p>

      <div class="sub-card" style="margin-bottom:14px; background:#f8fafc; border:1px solid #dbeafe;">
        <p style="margin:0; color:#334155; line-height:1.7;">
          ・セッション保持時間: ログイン状態を維持する上限時間（推奨 480分）<br>
          ・セッション確認間隔: 失効状態を検知するチェック間隔（推奨 5分）<br>
          ・無操作タイムアウト: 操作がない場合に再認証するまでの時間（推奨 30〜60分）<br>
          ・重要操作の再認証間隔: 管理画面の再認証間隔（推奨 30分）<br>
          ・重要操作パス: 再認証対象にするURL接頭辞（例: /admin/）
        </p>
      </div>

      <div class="form-row">
        <label class="form-label" for="auth-session-ttl">セッション保持時間（分）</label>
        <input id="auth-session-ttl" class="form-input" type="number" min="1" value="${Math.round(current.sessionTtlMs / 60000)}">
        <p style="margin:6px 0 0; color:#666; font-size:0.92em;">ログイン後に再PINなしで利用できる最大時間です。</p>
      </div>

      <div class="form-row">
        <label class="form-label" for="auth-heartbeat">セッション確認間隔（分）</label>
        <input id="auth-heartbeat" class="form-input" type="number" min="1" value="${Math.round(current.heartbeatMs / 60000)}">
        <p style="margin:6px 0 0; color:#666; font-size:0.92em;">短いほど失効検知は早くなりますが、通信回数は増えます。</p>
      </div>

      <div class="form-row">
        <label class="form-label" for="auth-idle-timeout">無操作タイムアウト（分）</label>
        <input id="auth-idle-timeout" class="form-input" type="number" min="1" value="${Math.round(current.idleTimeoutMs / 60000)}">
        <p style="margin:6px 0 0; color:#666; font-size:0.92em;">端末放置時の不正利用対策です。共有端末では短め推奨です。</p>
      </div>

      <div class="form-row">
        <label class="form-label" for="auth-stepup">重要操作の再認証間隔（分）</label>
        <input id="auth-stepup" class="form-input" type="number" min="1" value="${Math.round(current.stepupTtlMs / 60000)}">
        <p style="margin:6px 0 0; color:#666; font-size:0.92em;">管理操作のみ、前回認証からこの時間を超えると再PINが必要です。</p>
      </div>

      <div class="form-row">
        <label class="form-label" for="auth-sensitive-prefixes">重要操作パス（1行1件、先頭は /）</label>
        <textarea id="auth-sensitive-prefixes" class="form-input" rows="4">${current.sensitivePathPrefixes.join("\n")}</textarea>
        <p style="margin:6px 0 0; color:#666; font-size:0.92em;">例: /admin/ を指定すると、/admin/ 配下を再認証対象にします。</p>
      </div>

      <button id="save-auth-config-btn" class="primary-btn" style="margin-top:20px;">保存する</button>
    </div>
  `);

  const saveBtn = document.getElementById("save-auth-config-btn");
  saveBtn.onclick = async () => {
    const sessionTtlMin = Number(document.getElementById("auth-session-ttl")?.value || 0);
    const heartbeatMin = Number(document.getElementById("auth-heartbeat")?.value || 0);
    const idleMin = Number(document.getElementById("auth-idle-timeout")?.value || 0);
    const stepupMin = Number(document.getElementById("auth-stepup")?.value || 0);
    const sensitiveText = document.getElementById("auth-sensitive-prefixes")?.value || "";

    if (sessionTtlMin <= 0 || heartbeatMin <= 0 || idleMin <= 0 || stepupMin <= 0) {
      alert("時間設定は1以上の数値で入力してください");
      return;
    }

    const next = {
      sessionTtlMs: Math.floor(sessionTtlMin * 60000),
      heartbeatMs: Math.floor(heartbeatMin * 60000),
      idleTimeoutMs: Math.floor(idleMin * 60000),
      stepupTtlMs: Math.floor(stepupMin * 60000),
      sensitivePathPrefixes: normalizePathPrefixes(sensitiveText),
      updatedAt: new Date().toISOString()
    };

    showSaveModal("保存しています…");
    await saveJSON("data/auth-config.json", next);
    completeSaveModal("認証設定を保存しました");
  };
}
