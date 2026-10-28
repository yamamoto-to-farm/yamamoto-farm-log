import { config } from "/photos/config.js";
import { clearSession, ensureToken } from "/photos/auth.js";

let selectedDate = "";
let countRequest = 0;

async function updatePhotoCount(date) {
  const request = ++countRequest;
  const button = document.getElementById("openDayPhotos");
  button.textContent = "📷 この日の写真を見る（枚数確認中…）";
  button.title = "";
  try {
    const token = await ensureToken();
    if (!token) throw new Error("写真の枚数確認にはログインが必要です。");
    const query = new URLSearchParams({ date, countOnly: "1" });
    const response = await fetch(`${config.api}/photos/by-date?${query}`, {
      cache: "no-store", headers: { Authorization: `Bearer ${token}` }
    });
    if (response.status === 401) clearSession();
    if (!response.ok) throw new Error(`写真の枚数を取得できません（${response.status}）。`);
    const result = await response.json();
    if (!Number.isSafeInteger(result.total) || result.total < 0) {
      throw new Error("写真の枚数の応答が不正です。");
    }
    if (request === countRequest) button.textContent = `📷 この日の写真を見る　${result.total}枚`;
  } catch (error) {
    console.error("[photos] count failed", error);
    if (request === countRequest) {
      button.textContent = "📷 この日の写真を見る（枚数取得不可）";
      button.title = error.message;
    }
  }
}

async function loadDayPhotos() {
  const body = document.getElementById("dayPhotosBody");
  const date = selectedDate;
  body.textContent = "写真を読み込み中…";
  body.dataset.photoRequest = "";
  try {
    const panel = await import("/photos/panel.js?v=20261029-2");
    if (date !== selectedDate || !document.getElementById("dayPhotosDialog").open) return;
    await panel.mountPhotoPanel(body, { date });
  } catch (error) {
    console.error("[photos]", error);
    if (date === selectedDate) body.textContent = "写真を表示できません。閉じてから再度開いてください。";
  }
}

export function initDayPhotosModal() {
  const dialog = document.getElementById("dayPhotosDialog");
  document.getElementById("openDayPhotos").addEventListener("click", () => {
    if (!selectedDate) return;
    dialog.showModal();
    void updatePhotoCount(selectedDate);
    void loadDayPhotos();
  });
  document.getElementById("closeDayPhotos").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    const body = document.getElementById("dayPhotosBody");
    body.dataset.photoRequest = "";
    body.replaceChildren();
  });
}

export async function renderDayPhotos(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  selectedDate = date;
  const title = document.getElementById("dayPhotosTitle");
  if (!title) return;
  title.textContent = `${date.replaceAll("-", "/")} の写真`;
  document.getElementById("dayPhotosLink").href =
    `/photos/index.html?${new URLSearchParams({ from: date, to: date })}`;
  await updatePhotoCount(date);
  if (date !== selectedDate) return;
  if (document.getElementById("dayPhotosDialog").open) await loadDayPhotos();
}
