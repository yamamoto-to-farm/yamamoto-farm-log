// 圃場詳細ページの写真統合
// ・基本データ内：トップ写真＋「🏞 圃場の写真」ボタン（圃場タグ＋未分類をモーダル表示）
// ・各作付けカード：「🌱 生育写真を見る」ボタン（定植IDに紐づく栽培記録をモーダル表示）
import { fetchPhotos, openPhotoGridModal, showPhoto } from "/photos/panel.js?v=20261101-8";
import { fetchTopPhoto } from "/photos/top.js";
import { hasSession, login } from "/photos/auth.js?v=20261029-2";

export async function initFieldPhotos(field) {
  const card = document.querySelector(".field-detail-card");
  const listUrl = `/photos/index.html?field=${encodeURIComponent(field)}`;

  if (!hasSession()) {
    if (card) {
      const note = document.createElement("div");
      note.className = "field-photo-block";
      note.innerHTML = '<p class="photo-panel-message">写真を見るには写真用ログインが必要です。</p>';
      const button = document.createElement("button");
      button.type = "button";
      button.className = "secondary-btn";
      button.textContent = "写真用ログイン";
      button.addEventListener("click", () => login(location.pathname + location.search));
      note.append(button);
      card.prepend(note);
    }
    return;
  }

  let photos = [];
  let top = null;
  try {
    [photos, top] = await Promise.all([
      fetchPhotos({ field }).then(result => result || []),
      fetchTopPhoto(field).catch(() => null),
    ]);
  } catch (error) {
    console.error("[field-photos]", error);
    return;
  }

  // 基本データ内：トップ写真＋圃場写真ボタン（未分類も含めて取りこぼしを防ぐ）
  const fieldPhotos = photos.filter(photo => photo.category === "field" || !photo.category);
  if (card) {
    const block = document.createElement("div");
    block.className = "field-photo-block";
    if (top) {
      const wrap = document.createElement("span");
      wrap.className = "field-top-photo-wrap";
      const image = document.createElement("img");
      image.className = "field-top-photo";
      image.src = top.thumbUrl || top.url;
      image.alt = `${field}のトップ写真`;
      image.title = "クリックで拡大";
      image.addEventListener("click", () => showPhoto(top));
      wrap.append(image);
      block.append(wrap);
    }
    const actions = document.createElement("div");
    actions.className = "field-photo-actions";
    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "secondary-btn";
    openButton.textContent = `🏞 圃場の写真（${fieldPhotos.length}枚）`;
    openButton.addEventListener("click", () => openPhotoGridModal({
      title: `${field}：圃場の写真`,
      photos: fieldPhotos,
      emptyText: "圃場タグの写真はまだありません。",
      footer: `トップ写真の変更やタグ付けは <a href="${listUrl}">写真一覧</a> から行えます（未分類の写真もここに表示しています）。`,
    }));
    const listLink = document.createElement("a");
    listLink.className = "secondary-btn";
    listLink.href = listUrl;
    listLink.textContent = "📷 写真一覧・追加";
    actions.append(openButton, listLink);
    block.append(actions);
    card.prepend(block);
  }

  // 作付けカード：定植IDに紐づく栽培記録の写真
  for (const button of document.querySelectorAll(".planting-photos-btn")) {
    const ref = button.dataset.plantingRef;
    if (!ref) continue;
    const growth = photos.filter(photo => photo.plantingRef === ref);
    button.hidden = false;
    button.textContent = `🌱 生育写真を見る（${growth.length}枚）`;
    button.addEventListener("click", () => openPhotoGridModal({
      title: `${button.dataset.variety || ""} の生育写真`,
      photos: growth,
      emptyText: "この定植に紐づいた写真はまだありません。",
      footer: `<a href="${listUrl}">写真一覧</a>で「栽培記録」タグ＋定植の紐づけを設定すると、ここに表示されます。`,
    }));
  }
}
