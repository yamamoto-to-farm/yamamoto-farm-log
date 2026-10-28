import { config } from "./config.js";
import { clearSession, ensureToken, hasSession, login } from "./auth.js";
import { fetchTopPhoto, setTopPhoto } from "./top.js";

const MAX_PAGES = 10;
let dialog;

function viewer() {
  if (dialog) return dialog;
  dialog = document.createElement("dialog");
  dialog.className = "photo-panel-viewer";
  dialog.innerHTML = '<button type="button" class="secondary-btn">閉じる</button><img alt=""><p></p>';
  dialog.querySelector("button").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => dialog.querySelector("img").removeAttribute("src"));
  document.body.append(dialog);
  return dialog;
}

async function fetchPhotos(query) {
  const token = await ensureToken();
  if (!token) return null;
  const photos = [];
  let cursor = "";
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams(query);
    if (cursor) params.set("cursor", cursor);
    const path = query.date ? "/photos/by-date" : "/photos";
    const response = await fetch(`${config.api}${path}?${params}`, {
      cache: "no-store", headers: { Authorization: `Bearer ${await ensureToken()}` }
    });
    if (response.status === 401) {
      clearSession();
      return null;
    }
    if (!response.ok) throw new Error(`写真を取得できません（${response.status}）。`);
    const result = await response.json();
    if (!Array.isArray(result.photos)) throw new Error("写真一覧の応答が不正です。");
    photos.push(...result.photos);
    cursor = result.cursor;
    if (!cursor) break;
  }
  return photos.sort((a, b) => b.takenOn.localeCompare(a.takenOn) || b.uploadedAt.localeCompare(a.uploadedAt));
}

function show(photo) {
  const modal = viewer();
  const image = modal.querySelector("img");
  image.src = photo.url;
  image.alt = photo.note || `${photo.field}の写真`;
  modal.querySelector("p").textContent = `${photo.field}　${photo.takenOn}\n${photo.note || ""}`;
  modal.showModal();
}

function canSetTop() {
  return ["admin", "family"].includes(window.currentRole);
}

function render(container, photos, showField, topId, onSetTop) {
  const grid = document.createElement("div");
  grid.className = "photo-panel-grid";
  for (const photo of photos) {
    const figure = document.createElement("figure");
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", "写真を拡大");
    const image = document.createElement("img");
    image.src = photo.url;
    image.alt = photo.note || `${photo.field}の写真`;
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
    button.append(image);
    button.addEventListener("click", () => show(photo));
    const caption = document.createElement("figcaption");
    caption.textContent = showField ? `${photo.field}${photo.note ? "　" + photo.note : ""}` : `${photo.takenOn}${photo.note ? "　" + photo.note : ""}`;
    figure.append(button, caption);
    if (onSetTop) {
      if (photo.id === topId) {
        const mark = document.createElement("span");
        mark.className = "photo-panel-top";
        mark.textContent = "★トップ写真";
        figure.append(mark);
      } else if (canSetTop()) {
        const set = document.createElement("button");
        set.type = "button";
        set.className = "secondary-btn photo-panel-set-top";
        set.textContent = "トップ写真にする";
        set.addEventListener("click", () => onSetTop(photo, set));
        figure.append(set);
      }
    }
    grid.append(figure);
  }
  container.replaceChildren(grid);
}

// query: { field } または { date }。日付指定時は全圃場の写真を表示する。
export async function mountPhotoPanel(container, query) {
  const requestKey = JSON.stringify(query);
  container.dataset.photoRequest = requestKey;
  const isCurrent = () => container.dataset.photoRequest === requestKey;
  const message = (text, withLogin = false) => {
    const paragraph = document.createElement("p");
    paragraph.className = "photo-panel-message";
    paragraph.textContent = text;
    if (withLogin) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "secondary-btn";
      button.textContent = "写真用ログイン";
      button.addEventListener("click", () => login(location.pathname + location.search).catch(error => {
        paragraph.textContent = error.message;
      }));
      container.replaceChildren(paragraph, button);
    } else {
      container.replaceChildren(paragraph);
    }
  };
  if (!hasSession()) {
    message("写真を見るにはログインが必要です。", true);
    return;
  }
  message("写真を読み込み中…");
  try {
    const photos = await fetchPhotos(query);
    if (!isCurrent()) return;
    if (photos === null) message("ログインの有効期限が切れました。", true);
    else if (!photos.length) message("写真はありません。");
    else if (query.field) {
      let topId = (await fetchTopPhoto(query.field).catch(() => null))?.id;
      if (!isCurrent()) return;
      const draw = () => render(container, photos, false, topId, async (photo, button) => {
        button.disabled = true;
        try {
          await setTopPhoto(query.field, photo.id);
          topId = photo.id;
          draw();
        } catch (error) {
          button.disabled = false;
          alert(error.message);
        }
      });
      draw();
    } else render(container, photos, !!query.date);
  } catch (error) {
    console.error("[photos]", error);
    if (isCurrent()) message(error.message);
  }
}
