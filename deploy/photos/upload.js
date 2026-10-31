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

// 一覧表示用サムネイル（長辺360px・JPEG）。失敗したら null（本画像のみで続行）。
export async function makeThumbnail(blob) {
  try {
    const bitmap = await createImageBitmap(blob);
    try {
      const scale = Math.min(1, 360 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) return null;
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const thumb = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.8));
      return thumb && thumb.size <= 1024 * 1024 ? thumb : null;
    } finally {
      bitmap.close();
    }
  } catch {
    return null;
  }
}

export async function postToS3(upload, blob) {
  const form = new FormData();
  for (const [key, value] of Object.entries(upload.fields)) form.append(key, value);
  form.append("file", blob, "photo.jpg");
  return fetch(upload.url, { method: "POST", body: form, cache: "no-store" });
}

// 変換済みJPEGをアップロードして確定する。戻り値は写真ID。
export async function uploadPhoto({ field, takenOn, note = "", blob, logId = "" }) {
  const ticket = await api("/photos/uploads", { field, takenOn, note, ...(logId ? { logId } : {}) });
  const result = await postToS3(ticket.upload, blob);
  if (!result.ok) throw new Error(`S3への画像保存に失敗しました（${result.status}）。`);
  if (ticket.thumbUpload) {
    // サムネイルは任意（失敗しても本画像のみで保存を続ける）
    const thumb = await makeThumbnail(blob);
    if (thumb) {
      try { await postToS3(ticket.thumbUpload, thumb); } catch { /* 本画像のみで続行 */ }
    }
  }
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
        <label data-select-label>圃場<select class="form-input" name="field"></select></label>
        <div class="photo-upload-picker" data-picker hidden>
          <span class="photo-upload-picker-label">圃場</span>
          <button type="button" class="filter-open-btn" data-pick>圃場を選択</button>
          <strong data-picked>未選択</strong>
        </div>
        <label>撮影日<input class="form-input" name="takenOn" type="date" required></label>
        <label>写真（複数選択可）<input name="image" type="file" accept="image/jpeg,image/png,image/webp" multiple></label>
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
export function openPhotoUploadModal({ getFields, getDate, onUploaded, pickFromAll = false, initialField = "" }) {
  dialog ||= buildDialog();
  const form = dialog.querySelector("form");
  const message = dialog.querySelector(".photo-upload-message");
  const body = dialog.querySelector(".photo-upload-body");
  const saveButton = dialog.querySelector("[data-save]");
  const select = form.elements.field;
  const picker = dialog.querySelector("[data-picker]");
  const say = (text, isError = false) => {
    message.textContent = text;
    message.style.color = isError ? "#b3261e" : "";
  };

  const setPicked = name => {
    select.replaceChildren(...(name ? [new Option(name, name)] : []));
    picker.querySelector("[data-picked]").textContent = name || "未選択";
  };

  const fields = pickFromAll ? ["*"] : [...new Set((getFields() || []).filter(Boolean))];
  if (pickFromAll) {
    setPicked(initialField);
  } else {
    select.replaceChildren(...fields.map(name => new Option(name, name)));
  }
  dialog.querySelector("[data-select-label]").hidden = pickFromAll;
  picker.hidden = !pickFromAll;
  form.elements.takenOn.value = getDate() || "";
  form.elements.image.value = "";
  form.elements.note.value = "";
  say("");

  // 共通の圃場モーダルは<dialog>の背面に出るため、選択中だけ閉じて再表示する
  picker.querySelector("[data-pick]").onclick = async () => {
    const { openFieldModal } = await import("/common/filter/filter-field.js?v=1");
    const container = document.getElementById("modal-container");
    let reopened = false;
    const reopen = () => {
      if (reopened) return;
      reopened = true;
      observer.disconnect();
      if (!dialog.open) dialog.showModal();
    };
    const observer = new MutationObserver(() => {
      if (!container.hasChildNodes()) reopen();
    });
    dialog.close();
    openFieldModal({
      mode: "select",
      includeExpired: true,
      selectedField: select.value,
      onSelect: name => {
        setPicked(name);
        say("");
      }
    }).then(() => {
      observer.observe(document.getElementById("modal-container"), { childList: true });
    });
  };

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
    const files = [...form.elements.image.files];
    if (!field || !takenOn || !files.length) {
      say("圃場・撮影日・写真を指定してください。", true);
      return;
    }
    busy = true;
    saveButton.disabled = true;
    let saved = 0;
    const errors = [];
    try {
      for (let index = 0; index < files.length; index++) {
        const step = files.length > 1 ? `（${index + 1}/${files.length}枚目）` : "";
        try {
          say(`画像を変換しています…${step}`);
          const blob = await convertToJpeg(files[index]);
          say(`アップロードしています…${step}`);
          await uploadPhoto({ field, takenOn, note: form.elements.note.value, blob });
          saved += 1;
          onUploaded?.({ field, takenOn });
        } catch (error) {
          console.error("[photos] upload failed", files[index]?.name, error);
          errors.push(`${files[index]?.name || index + 1}: ${error.message}`);
        }
      }
      if (!errors.length) {
        form.elements.image.value = "";
        form.elements.note.value = "";
        say(`「${field}」に${saved}枚保存しました。続けて追加できます。`);
      } else {
        say(`${saved}枚保存・${errors.length}枚失敗しました。${errors[0]}`, true);
      }
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
