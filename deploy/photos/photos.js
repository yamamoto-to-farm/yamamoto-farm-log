import { config } from "./config.js";
import { clearSession, getToken, login, logout } from "./auth.js";

const element = id => document.getElementById(id);
let selectedField = new URLSearchParams(location.search).get("field") || "";
let cursor = null;
let photos = [];
let previewUrl = null;
let busy = false;
let generation = 0;

function status(message, isError = false) {
  element("status").textContent = message;
  element("status").classList.toggle("error", isError);
}

function showSession() {
  const authenticated = !!getToken();
  element("login").hidden = authenticated;
  element("logout").hidden = !authenticated;
  element("photo-area").hidden = !authenticated;
  if (!authenticated) {
    photos = [];
    element("gallery").replaceChildren();
    element("more").hidden = true;
    element("viewer").close();
    element("full-image").removeAttribute("src");
  }
  return authenticated;
}

function report(error) {
  console.error("[photos]", error);
  status(error.message, true);
  showSession();
}

async function api(path, data, signal) {
  const token = getToken();
  if (!token) throw new Error("写真用ログインの期限が切れました。再ログインしてください。");
  const url = new URL(`${config.api}${path}`);
  const options = {
    cache: "no-store", signal,
    headers: { Authorization: `Bearer ${token}` }
  };
  if (data) {
    options.method = "POST";
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(data);
  }
  const response = await fetch(url, options);
  if (response.status === 401) {
    clearSession();
    throw new Error("写真用ログインをやり直してください。");
  }
  if (!response.ok) {
    const body = await response.text();
    let message = `写真APIでエラーが発生しました（${response.status}）。`;
    try {
      const parsed = JSON.parse(body);
      if (typeof parsed.message === "string") message += ` ${parsed.message}`;
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
    throw new Error(message);
  }
  return response.json();
}

function renderGallery() {
  element("gallery").replaceChildren();
  photos.sort((a, b) => b.takenOn.localeCompare(a.takenOn) || b.uploadedAt.localeCompare(a.uploadedAt));
  for (const photo of photos) {
    const card = document.createElement("article");
    card.className = "photo-card";
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", `${photo.takenOn}の写真を拡大`);
    const image = document.createElement("img");
    image.src = photo.url;
    image.alt = photo.note || `${photo.field}の写真`;
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
    image.addEventListener("error", () => {
      status("画像を読み込めません。一覧を更新してください（URLの有効期間は5分です）。", true);
    });
    button.append(image);
    button.addEventListener("click", () => {
      if (!showSession()) {
        status("再ログインしてください。", true);
        return;
      }
      element("full-image").src = photo.url;
      element("full-image").alt = image.alt;
      element("caption").textContent = `${photo.field}　${photo.takenOn}\n${photo.note}`;
      element("viewer").showModal();
    });
    const caption = document.createElement("p");
    caption.textContent = `${photo.takenOn}\n${photo.note}`;
    card.append(button, caption);
    element("gallery").append(card);
  }
  element("more").hidden = !cursor;
}

async function loadPhotos(append = false) {
  const field = element("field").value;
  const requestGeneration = ++generation;
  if (!field) {
    cursor = null;
    photos = [];
    renderGallery();
    status("圃場を選択してください。");
    return;
  }
  status("写真一覧を読み込み中…");
  const query = new URLSearchParams({ field });
  if (append && cursor) query.set("cursor", cursor);
  const result = await api(`/photos?${query}`);
  if (requestGeneration !== generation) return;
  if (!Array.isArray(result.photos)) throw new Error("写真一覧の応答が不正です。");
  photos = append ? [...photos, ...result.photos] : result.photos;
  cursor = result.cursor;
  renderGallery();
  status(photos.length ? `${photos.length}枚を表示中${cursor ? "（続きがあります）" : ""}` : "この圃場の写真はまだありません。");
}

async function jpeg(file) {
  if (!file || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("JPEG・PNG・WebPのいずれかを選択してください。HEICは変換が必要です。");
  }
  if (file.size > 20 * 1024 * 1024) throw new Error("元画像は20MB以下にしてください。");
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
    if (!blob || blob.size > 5 * 1024 * 1024) throw new Error("画像を5MB以下に変換できません。小さい画像を選んでください。");
    return blob;
  } finally {
    bitmap.close();
  }
}

async function upload(event) {
  event.preventDefault();
  if (busy) return;
  const field = element("field").value;
  if (!field) {
    status("圃場を選択してください。", true);
    return;
  }
  busy = true;
  for (const control of document.querySelectorAll("#upload-form input, #upload-form textarea, #upload-form button, #field, #refresh, #more")) {
    control.disabled = true;
  }
  let saved = false;
  try {
    status("画像を変換しています…");
    const blob = await jpeg(element("image").files[0]);
    status("写真をアップロードしています…");
    const ticket = await api("/photos/uploads", {
      field, takenOn: element("taken-on").value, note: element("note").value
    });
    const form = new FormData();
    for (const [key, value] of Object.entries(ticket.upload.fields)) form.append(key, value);
    form.append("file", blob, "photo.jpg");
    const result = await fetch(ticket.upload.url, { method: "POST", body: form, cache: "no-store" });
    if (!result.ok) throw new Error(`S3への画像保存に失敗しました（${result.status}）。`);
    await api("/photos/complete", { field, id: ticket.id });
    saved = true;
    element("image").value = "";
    element("note").value = "";
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    element("preview").hidden = true;
    element("preview").removeAttribute("src");
    // Read all pages so the newly saved photo is visible even after the first 20.
    await loadPhotos();
    while (cursor) await loadPhotos(true);
    status("写真を保存しました。");
  } catch (error) {
    if (saved) {
      report(new Error(`写真の保存は完了しましたが、一覧の更新に失敗しました。再アップロードせず「一覧を更新」を押してください。 ${error.message}`));
    } else {
      report(error);
    }
  } finally {
    busy = false;
    for (const control of document.querySelectorAll("#upload-form input, #upload-form textarea, #upload-form button, #field, #refresh, #more")) {
      control.disabled = false;
    }
  }
}

element("login").addEventListener("click", () => login(selectedField).catch(report));
element("logout").addEventListener("click", () => {
  logout();
  showSession();
});
element("upload-form").addEventListener("submit", upload);
element("close-viewer").addEventListener("click", () => element("viewer").close());
element("viewer").addEventListener("close", () => element("full-image").removeAttribute("src"));
element("image").addEventListener("change", async () => {
  element("preview").hidden = true;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  const file = element("image").files[0];
  if (!file) return;
  try {
    const blob = await jpeg(file);
    if (element("image").files[0] !== file) return;
    previewUrl = URL.createObjectURL(blob);
    element("preview").src = previewUrl;
    element("preview").hidden = false;
    status("プレビューを確認し、撮影日とメモを入力して保存してください。");
  } catch (error) {
    report(error);
  }
});
element("field").addEventListener("change", () => {
  selectedField = element("field").value;
  const url = new URL(location.href);
  if (selectedField) url.searchParams.set("field", selectedField);
  else url.searchParams.delete("field");
  history.replaceState(null, "", url);
  photos = [];
  cursor = null;
  renderGallery();
  loadPhotos().catch(report);
});
element("refresh").addEventListener("click", () => loadPhotos().catch(report));
element("more").addEventListener("click", async () => {
  element("more").disabled = true;
  try { await loadPhotos(true); } catch (error) { report(error); }
  finally { element("more").disabled = false; }
});
window.addEventListener("pageshow", showSession);
setInterval(showSession, 15000);

async function init() {
  const now = new Date();
  element("taken-on").value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  if (selectedField) element("field-back").href = `/fields/index.html?field=${encodeURIComponent(selectedField)}`;
  if (!showSession()) return;
  const response = await fetch("/data/fields.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`圃場一覧を読み込めません（${response.status}）。`);
  const fields = await response.json();
  for (const field of fields) {
    const option = document.createElement("option");
    option.value = field.name;
    option.textContent = field.name;
    element("field").append(option);
  }
  element("field").value = selectedField;
  await loadPhotos();
}

init().catch(report);
