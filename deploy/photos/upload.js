import { config } from "./config.js";
import { clearSession, ensureToken, hasSession, login } from "./auth.js";

const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

async function api(path, data) {
  const token = await ensureToken();
  if (!token) throw new Error("写真用ログインの期限が切れました。再ログインしてください。");
  const response = await fetch(`${config.api}${path}`, {
    method: "POST", cache: "no-store",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
  if (response.status === 401) {
    clearSession();
    throw new Error("写真用ログインをやり直してください。");
  }
  if (!response.ok) {
    let message = `写真APIでエラーが発生しました（${response.status}）。`;
    try {
      const parsed = await response.json();
      if (typeof parsed.message === "string") message += ` ${parsed.message}`;
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
    throw new Error(message);
  }
  return response.json();
}

// 長辺1920px以下のJPEG(5MB以下)に変換する。
export async function convertToJpeg(file) {
  if (!file || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("JPEG・PNG・WebPのいずれかを選択してください。HEICは変換が必要です。");
  }
  if (file.size > MAX_SOURCE_BYTES) throw new Error("元画像は20MB以下にしてください。");
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("このブラウザーでは画像を変換できません。");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob || blob.size > MAX_UPLOAD_BYTES) throw new Error("画像を5MB以下に変換できません。小さい画像を選んでください。");
    return blob;
  } finally {
    bitmap.close();
  }
}

// 変換済みJPEGをアップロードして確定する。戻り値は写真ID。
export async function uploadPhoto({ field, takenOn, note = "", blob, logId = "" }) {
  const ticket = await api("/photos/uploads", { field, takenOn, note, ...(logId ? { logId } : {}) });
  const form = new FormData();
  for (const [key, value] of Object.entries(ticket.upload.fields)) form.append(key, value);
  form.append("file", blob, "photo.jpg");
  const result = await fetch(ticket.upload.url, { method: "POST", body: form, cache: "no-store" });
  if (!result.ok) throw new Error(`S3への画像保存に失敗しました（${result.status}）。`);
  await api("/photos/complete", { field, id: ticket.id });
  return ticket.id;
}

let dialog;

function buildDialog() {
  const modal = document.createElement("dialog");
  modal.className = "photo-upload-modal";
  modal.innerHTML = `
    <form method="dialog" class="photo-upload-form">
      <h2>写真を追加</h2>
      <p class="photo-upload-message" role="status" aria-live="polite"></p>
      <div class="photo-upload-body">
        <label>圃場<select class="form-input" name="field"></select></label>
        <label>撮影日<input class="form-input" name="takenOn" type="date" required></label>
        <label>写真（1枚ずつ）<input name="image" type="file" accept="image/jpeg,image/png,image/webp"></label>
        <label>メモ<textarea class="form-textarea" name="note" maxlength="1000"></textarea></label>
      </div>
      <div class="photo-upload-actions">
        <button type="submit" class="primary-btn" data-save>保存</button>
        <button type="button" class="secondary-btn" data-close>閉じる</button>
      </div>
    </form>`;
  document.body.append(modal);
  return modal;
}

/**
 * 写真追加モーダルを開く。
 * getFields: 選択可能な圃場名の配列を返す関数 / getDate: 撮影日(YYYY-MM-DD)の初期値を返す関数
 * onUploaded: 1枚保存するたびに呼ばれる
 */
export function openPhotoUploadModal({ getFields, getDate, onUploaded }) {
  dialog ||= buildDialog();
  const form = dialog.querySelector("form");
  const message = dialog.querySelector(".photo-upload-message");
  const body = dialog.querySelector(".photo-upload-body");
  const saveButton = dialog.querySelector("[data-save]");
  const select = form.elements.field;
  const say = (text, isError = false) => {
    message.textContent = text;
    message.style.color = isError ? "#b3261e" : "";
  };

  const fields = [...new Set((getFields() || []).filter(Boolean))];
  select.replaceChildren(...fields.map(name => new Option(name, name)));
  form.elements.takenOn.value = getDate() || "";
  form.elements.image.value = "";
  form.elements.note.value = "";
  say("");

  const loggedIn = hasSession();
  body.hidden = !fields.length || !loggedIn;
  saveButton.hidden = body.hidden;
  if (!fields.length) {
    say("先に圃場を選択してください。", true);
  } else if (!loggedIn) {
    say("写真を保存するにはログインが必要です。");
  }
  let busy = false;

  dialog.querySelector("[data-close]").onclick = () => { if (!busy) dialog.close(); };
  dialog.oncancel = event => { if (busy) event.preventDefault(); };
  form.onsubmit = async event => {
    event.preventDefault();
    if (busy) return;
    const field = select.value;
    const takenOn = form.elements.takenOn.value;
    const file = form.elements.image.files[0];
    if (!field || !takenOn || !file) {
      say("圃場・撮影日・写真を指定してください。", true);
      return;
    }
    busy = true;
    saveButton.disabled = true;
    try {
      say("画像を変換しています…");
      const blob = await convertToJpeg(file);
      say("アップロードしています…");
      await uploadPhoto({ field, takenOn, note: form.elements.note.value, blob });
      form.elements.image.value = "";
      form.elements.note.value = "";
      say(`「${field}」に保存しました。続けて追加できます。`);
      onUploaded?.({ field, takenOn });
    } catch (error) {
      console.error("[photos] upload failed", error);
      say(error.message, true);
    } finally {
      busy = false;
      saveButton.disabled = false;
    }
  };

  if (!loggedIn && fields.length) {
    const loginButton = document.createElement("button");
    loginButton.type = "button";
    loginButton.className = "secondary-btn";
    loginButton.textContent = "写真用ログイン";
    loginButton.onclick = () => login(location.pathname + location.search);
    message.append(" ", loginButton);
  }
  dialog.showModal();
}

/**
 * 入力フォームに「写真を追加」ボタンを置く。保存した枚数も表示する。
 * 複数圃場のページは getFields に選択中の圃場すべてを返す。単一圃場なら1件の配列。
 */
export function mountPhotoAttach(container, { getFields, getDate }) {
  const wrapper = document.createElement("div");
  wrapper.className = "photo-attach";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary-btn";
  button.textContent = "📷 写真を追加";
  const counter = document.createElement("span");
  counter.className = "photo-attach-count";
  let count = 0;
  button.addEventListener("click", () => openPhotoUploadModal({
    getFields, getDate,
    onUploaded: () => {
      count += 1;
      counter.textContent = `${count}枚保存済み`;
    }
  }));
  wrapper.append(button, counter);
  container.append(wrapper);
}
