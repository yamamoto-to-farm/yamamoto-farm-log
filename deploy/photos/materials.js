import { config } from "/photos/config.js";
import { clearSession, ensureToken, hasSession, login } from "/photos/auth.js";
import { convertToJpeg, makeThumbnail, postToS3 } from "/photos/upload.js?v=20261101-5";

async function request(path, data, post = false) {
  const token = await ensureToken();
  if (!token) throw new Error("写真用ログインが必要です。");
  const url = `${config.api}${path}${post ? "" : `?${new URLSearchParams(data)}`}`;
  const options = { cache: "no-store", headers: { Authorization: `Bearer ${token}` } };
  if (post) {
    options.method = "POST";
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(data);
  }
  const response = await fetch(url, options);
  if (response.status === 401) clearSession();
  if (!response.ok) {
    let message = `写真の処理に失敗しました（${response.status}）。`;
    try {
      const body = await response.json();
      if (body.message) message += ` ${body.message}`;
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
    throw new Error(message);
  }
  return response.json();
}

export async function listMaterialPhotos(materialType, materialId = "", cursor = "") {
  const result = await request("/photos", {
    materialType, ...(materialId ? { materialId } : {}), ...(cursor ? { cursor } : {})
  });
  if (!Array.isArray(result.photos)) throw new Error("資材写真の応答が不正です。");
  return result;
}

function message(node, text, error = false) {
  node.textContent = text;
  node.style.color = error ? "#b91c1c" : "";
}

function loginButton(parent, returnTo = location.pathname + location.search) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary-btn";
  button.textContent = "写真用ログイン";
  button.onclick = () => {
    if (!confirm("ログイン画面へ移動します。入力中の未保存の内容は失われます。よろしいですか？")) return;
    login(returnTo).catch(error => {
    console.error("[material-photos] login", error);
    alert(error.message);
    });
  };
  parent.append(button);
}

function imageCard(photo, label) {
  const card = document.createElement("div");
  card.className = "material-photo";
  const link = document.createElement("a");
  link.href = photo.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.setAttribute("aria-label", `${label}の画像を拡大`);
  const image = document.createElement("img");
  image.src = photo.thumbUrl || photo.url;
  image.alt = `${label}の画像`;
  image.loading = "lazy";
  image.referrerPolicy = "no-referrer";
  image.onerror = () => {
    const error = document.createElement("span");
    error.textContent = "画像を読み込めません。再読み込みしてください。";
    error.style.color = "#b91c1c";
    card.append(error);
  };
  link.append(image);
  card.append(link);
  return card;
}

export function mountMaterialEditor(container, materialType, materialId, selectionControls = []) {
  container.replaceChildren();
  if (!materialId) return;
  const title = document.createElement("h2");
  title.textContent = "資材の画像";
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  const content = document.createElement("div");
  container.append(title, status, content);
  if (!hasSession()) {
    message(status, "画像の確認・登録には写真用ログインが必要です。");
    const destination = new URL(location.href);
    destination.searchParams.set("pid", materialId);
    loginButton(content, destination.pathname + destination.search);
    return;
  }
  const identity = { materialType, materialId };
  let busy = false;
  let disabledStates = [];
  function warnBeforeLeaving(event) {
    event.preventDefault();
    event.returnValue = "";
  }
  function setBusy(value) {
    busy = value;
    if (value) {
      disabledStates = selectionControls.map(control => control.disabled);
      selectionControls.forEach(control => { control.disabled = true; });
      window.addEventListener("beforeunload", warnBeforeLeaving);
    } else {
      selectionControls.forEach((control, index) => { control.disabled = disabledStates[index]; });
      window.removeEventListener("beforeunload", warnBeforeLeaving);
    }
  }
  async function load() {
    message(status, "画像を読み込み中…");
    const result = await listMaterialPhotos(materialType, materialId);
    if (!container.isConnected) return;
    content.replaceChildren();
    const gallery = document.createElement("div");
    gallery.className = "material-photos-grid";
    async function removePhoto(photoId, button) {
      if (busy || !confirm("この画像を一覧から削除します。代表画像の場合は別の画像が代表になります。過去のバージョンは非公開の保存先に残ります。よろしいですか？")) return;
      setBusy(true);
      button.disabled = true;
      try {
        await request("/photos/delete", { ...identity, id: photoId }, true);
        try {
          await load();
          message(status, "画像を削除しました。");
        } catch (error) {
          console.error("[material-photos] refresh after delete", error);
          message(status, `画像は削除されましたが、一覧を更新できません: ${error.message}`, true);
        }
      } catch (error) {
        console.error("[material-photos] delete", error);
        message(status, `${error.message} 削除を再試行できます。`, true);
        button.disabled = false;
      } finally { setBusy(false); }
    }
    for (const photo of result.photos) {
      const card = imageCard(photo, materialId);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "secondary-btn";
      button.disabled = photo.representative;
      button.textContent = photo.representative ? "★ 代表画像" : "代表画像にする";
      button.onclick = async () => {
        if (busy) return;
        setBusy(true);
        button.disabled = true;
        try {
          await request("/photos/edit", { ...identity, id: photo.id, action: "representative" }, true);
          await load();
        } catch (error) {
          console.error("[material-photos] representative", error);
          message(status, error.message, true);
          button.disabled = false;
        } finally { setBusy(false); }
      };
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "secondary-btn";
      remove.textContent = "画像を削除";
      remove.onclick = () => removePhoto(photo.id, remove);
      card.append(button, remove);
      gallery.append(card);
    }
    content.append(gallery);
    for (const photoId of result.pendingDeletions || []) {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "secondary-btn";
      retry.textContent = "削除を再試行";
      retry.onclick = () => removePhoto(photoId, retry);
      content.append(retry);
    }
    const form = document.createElement("form");
    const label = document.createElement("label");
    label.textContent = "画像を追加（JPEG・PNG・WebP、複数選択可）";
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/webp";
    input.multiple = true;
    label.append(input);
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "secondary-btn";
    submit.textContent = "画像を登録";
    form.append(label, submit);
    form.onsubmit = async event => {
      event.preventDefault();
      if (busy) return;
      const files = [...input.files];
      if (!files.length) { message(status, "画像を選択してください。", true); return; }
      setBusy(true);
      submit.disabled = true;
      let completed = 0;
      try {
        for (const file of files) {
          message(status, `登録中 ${completed + 1} / ${files.length}…`);
          const blob = await convertToJpeg(file);
          const upload = await request("/photos/uploads", identity, true);
          const result = await postToS3(upload.upload, blob);
          if (!result.ok) throw new Error(`画像保存に失敗しました（${result.status}）。`);
          const thumb = await makeThumbnail(blob);
          if (thumb) {
            const result = await postToS3(upload.thumbUpload, thumb);
            if (!result.ok) throw new Error(`サムネイル保存に失敗しました（${result.status}）。`);
          }
          await request("/photos/complete", { ...identity, id: upload.id }, true);
          completed++;
        }
        await load();
        message(status, `${completed}枚を登録しました。画像は詳細情報の保存とは別に保存されます。`);
      } catch (error) {
        console.error("[material-photos] upload", error);
        input.value = "";
        let detail = `${error.message} 登録済み: ${completed}枚。残りの画像を選び直してください。`;
        if (completed) {
          try { await load(); }
          catch (reloadError) {
            console.error("[material-photos] reload after upload", reloadError);
            detail += ` 一覧更新にも失敗しました: ${reloadError.message}`;
          }
        }
        message(status, detail, true);
      } finally { setBusy(false); submit.disabled = false; }
    };
    content.append(form);
    message(status, result.pendingDeletions?.length
      ? "削除が未完了の画像があります。「削除を再試行」を押してください。"
      : result.photos.length
      ? "画像は詳細情報の保存とは別に保存されます。"
      : "画像はまだ登録されていません。");
  }
  load().catch(error => {
    console.error("[material-photos] editor", error);
    if (container.isConnected) message(status, error.message, true);
  });
}

export function mountSelectedMaterialPhotos(container, selected, dictionary) {
  let generation = 0;
  const cached = new Map();
  function getPhotos(entry) {
    const key = `${entry.materialType}:${entry.id}`;
    const existing = cached.get(key);
    if (existing && Date.now() - existing.at < 10 * 60 * 1000) return existing.result;
    const result = listMaterialPhotos(entry.materialType, entry.id).catch(error => {
      if (cached.get(key)?.result === result) cached.delete(key);
      throw error;
    });
    cached.set(key, { at: Date.now(), result });
    return result;
  }
  async function refresh() {
    const current = ++generation;
    const names = selected();
    container.replaceChildren();
    if (!names.length) return;
    if (!hasSession()) {
      const note = document.createElement("p");
      note.textContent = "資材画像の表示には写真用ログインが必要です。ログ入力はそのまま利用できます。";
      container.append(note);
      loginButton(container);
      return;
    }
    const status = document.createElement("p");
    status.setAttribute("role", "status");
    status.textContent = "資材画像を読み込み中…";
    container.append(status);
    const gallery = document.createElement("div");
    gallery.className = "material-photos-grid";
    container.append(gallery);
    let failed = false;
    const items = await Promise.all(names.map(async name => {
      const entry = dictionary[name];
      if (!entry?.id || !entry.materialType) return null;
      try {
        const result = await getPhotos(entry);
        return { name, photo: result.photos.find(photo => photo.representative) };
      } catch (error) {
        console.error("[material-photos] selected", error);
        failed = true;
        return null;
      }
    }));
    if (current !== generation) return;
    for (const item of items) {
      if (!item?.photo) continue;
      const card = imageCard(item.photo, item.name);
      const name = document.createElement("span");
      name.textContent = item.name;
      card.append(name);
      gallery.append(card);
    }
    message(status, failed ? "一部の資材画像を取得できません。ログ入力は続けられます。" :
      gallery.children.length ? "選択した資材の代表画像" : "選択した資材に画像は登録されていません。", failed);
  }
  window.addEventListener("filter:apply", refresh);
  window.addEventListener("filter:reset", refresh);
  refresh();
}

export function mountMaterialGallery(container, materialType) {
  let cursor = "";
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  const gallery = document.createElement("div");
  gallery.className = "material-photos-grid";
  const more = document.createElement("button");
  more.type = "button";
  more.className = "secondary-btn";
  more.textContent = "続きを読み込む";
  more.hidden = true;
  container.replaceChildren(status, gallery, more);
  async function load() {
    more.disabled = true;
    message(status, "資材画像を読み込み中…");
    try {
      const [result, indexResponse] = await Promise.all([
        listMaterialPhotos(materialType, "", cursor),
        fetch(`/data/${materialType}/${materialType}-index.json`, { cache: "no-store" })
      ]);
      if (!indexResponse.ok) throw new Error(`資材一覧を取得できません（${indexResponse.status}）。`);
      const index = await indexResponse.json();
      const names = new Map(index.map(item => [item.id, item.name]));
      for (const photo of result.photos) {
        const name = names.get(photo.materialId) || photo.materialId;
        const card = imageCard(photo, name);
        const label = document.createElement("strong");
        label.textContent = `${name}${photo.representative ? " ★代表" : ""}`;
        const edit = document.createElement("a");
        edit.href = `/admin/edit-json/index.html?${new URLSearchParams({ data: `${materialType}-detail`, pid: photo.materialId })}`;
        edit.textContent = "詳細・画像を編集";
        card.append(label, edit);
        gallery.append(card);
      }
      cursor = result.cursor || "";
      more.hidden = !cursor;
      message(status, gallery.children.length ? `${gallery.children.length}枚を表示中` : "画像はまだ登録されていません。");
    } catch (error) {
      console.error("[material-photos] gallery", error);
      message(status, error.message, true);
      more.hidden = false;
      more.textContent = "再読み込み";
    } finally { more.disabled = false; }
  }
  more.onclick = load;
  if (!hasSession()) {
    message(status, "画像を見るには写真用ログインが必要です。");
    loginButton(container);
  } else load();
}
