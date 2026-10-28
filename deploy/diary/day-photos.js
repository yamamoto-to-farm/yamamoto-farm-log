export async function renderDayPhotos(date) {
  const body = document.getElementById("dayPhotosBody");
  if (!body || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  try {
    const panel = await import("/photos/panel.js?v=20261029-1");
    await panel.mountPhotoPanel(body, { date });
  } catch (error) {
    console.error("[photos]", error);
    body.textContent = "写真を表示できません。";
  }
}
