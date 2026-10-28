let selectedDate = "";

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
  if (document.getElementById("dayPhotosDialog").open) await loadDayPhotos();
}
