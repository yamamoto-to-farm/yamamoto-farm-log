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

function uploadForm(identity, status, setBusy, refresh, isBusy = () => false) {
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
  let busy = false;
  form.onsubmit = async event => {
    event.preventDefault();
    if (busy || isBusy()) return;
    const files = [...input.files];
    if (!files.length) { message(status, "画像を選択してください。", true); return; }
    busy = true;
    setBusy(true);
    submit.disabled = true;
    let completed = 0;
    let uploaded = false;
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
      uploaded = true;
      await refresh();
      message(status, `${completed}枚を登録しました。`);
    } catch (error) {
      console.error("[material-photos] upload", error);
      input.value = "";
      let detail = uploaded
        ? `${completed}枚は登録されましたが、一覧を更新できません: ${error.message}`
        : `${error.message} 登録済み: ${completed}枚。残りの画像を選び直してください。`;
      if (completed && !uploaded) {
        try { await refresh(); }
        catch (reloadError) {
          console.error("[material-photos] reload after upload", reloadError);
          detail += ` 一覧更新にも失敗しました: ${reloadError.message}`;
        }
      }
      message(status, detail, true);
    } finally { busy = false; setBusy(false); submit.disabled = false; }
  };
  return form;
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
      if (photo.transfer) {
        const note = document.createElement("span");
        note.textContent = "紐づけ変更が未完了です。写真一覧から再試行してください。";
        card.append(note);
        gallery.append(card);
        continue;
      }
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
    content.append(uploadForm(identity, status, setBusy, load, () => busy));
    const choose = document.createElement("a");
    choose.href = `/photos/index.html?${new URLSearchParams({ tab: materialType, associate: materialId })}`;
    choose.textContent = "写真一覧から画像を選ぶ";
    choose.onclick = event => {
      if (busy || !confirm("写真一覧へ移動します。入力中の未保存の内容は失われます。よろしいですか？")) event.preventDefault();
    };
    content.append(choose);
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

export function mountMaterialGallery(container, materialType, preferredId = "") {
  let cursor = "";
  let busy = false;
  let disabledStates = [];
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  const gallery = document.createElement("div");
  gallery.className = "material-photos-grid";
  const controls = document.createElement("div");
  const retries = document.createElement("div");
  const more = document.createElement("button");
  more.type = "button";
  more.className = "secondary-btn";
  more.textContent = "続きを読み込む";
  more.hidden = true;
  container.replaceChildren(status, controls, retries, gallery, more);
  function warnBeforeLeaving(event) {
    event.preventDefault();
    event.returnValue = "";
  }
  function setBusy(value) {
    busy = value;
    const tabs = [...document.querySelectorAll("[data-photo-tab]")];
    if (value) {
      disabledStates = tabs.map(tab => tab.disabled);
      tabs.forEach(tab => { tab.disabled = true; });
      window.addEventListener("beforeunload", warnBeforeLeaving);
    } else {
      tabs.forEach((tab, index) => { tab.disabled = disabledStates[index]; });
      window.removeEventListener("beforeunload", warnBeforeLeaving);
    }
  }
  async function load(append = false) {
    if (!append) {
      cursor = "";
      gallery.replaceChildren();
      retries.replaceChildren();
    }
    more.disabled = true;
    message(status, "資材画像を読み込み中…");
    try {
      const [result, indexResponse, unassigned] = await Promise.all([
        listMaterialPhotos(materialType, "", cursor),
        fetch(`/data/${materialType}/${materialType}-index.json`, { cache: "no-store" }),
        request("/photos", { materialType, unassigned: "1" })
      ]);
      if (!indexResponse.ok) throw new Error(`資材一覧を取得できません（${indexResponse.status}）。`);
      const index = await indexResponse.json();
      if (!Array.isArray(index) || !Array.isArray(unassigned.photos)) {
        throw new Error("資材一覧または未紐づけ画像の応答が不正です。");
      }
      const names = new Map(index.map(item => [item.id, item.name]));
      controls.replaceChildren();
      if (result.canManage) {
        const note = document.createElement("p");
        note.textContent = preferredId && names.has(preferredId)
          ? `「${names.get(preferredId)}」に紐づける画像を選べます。`
          : "画像を先に登録し、後から資材に紐づけられます。";
        controls.append(note, uploadForm(
          { materialType, materialId: "", unassigned: true }, status, setBusy, () => load(), () => busy));
        const pending = [
          ...(append ? [] : (unassigned.pendingDeletions || []).map(id => ({ id, materialId: "" }))),
          ...(result.pendingDeletions || []).filter(item => item.materialId)
        ];
        for (const item of pending) {
          const retry = document.createElement("button");
          retry.type = "button";
          retry.textContent = `${names.get(item.materialId) || item.materialId || "未紐づけ"}の画像削除を再試行`;
          retry.onclick = async () => {
            if (busy || !confirm("未完了の画像削除を再試行します。よろしいですか？")) return;
            setBusy(true);
            try {
              await request("/photos/delete", {
                materialType, materialId: item.materialId, id: item.id,
                ...(item.materialId ? {} : { unassigned: true })
              }, true);
              await load();
              message(status, "画像を削除しました。");
            } catch (error) {
              console.error("[material-photos] retry delete", error);
              message(status, `${error.message} 削除を再試行できます。`, true);
            } finally { setBusy(false); }
          };
          retries.append(retry);
        }
      }
      const reload = document.createElement("button");
      reload.type = "button";
      reload.className = "secondary-btn";
      reload.textContent = "一覧を更新";
      reload.onclick = () => {
        if (!busy) load().catch(error => console.error("[material-photos] refresh", error));
      };
      controls.append(reload);
      const visiblePhotos = [
        ...(append ? [] : unassigned.photos),
        ...result.photos.filter(photo => photo.materialId)
      ];
      for (const photo of visiblePhotos) {
        const name = photo.materialId ? (names.get(photo.materialId) || photo.materialId) : "未紐づけ";
        const card = imageCard(photo, name);
        const label = document.createElement("strong");
        label.textContent = `${name}${photo.representative ? " ★代表" : ""}`;
        card.append(label);
        if (photo.materialId) {
          const edit = document.createElement("a");
          edit.href = `/admin/edit-json/index.html?${new URLSearchParams({ data: `${materialType}-detail`, pid: photo.materialId })}`;
          edit.textContent = "詳細・画像を編集";
          card.append(edit);
        }
        if (result.canManage) {
          const select = document.createElement("select");
          select.setAttribute("aria-label", `${name}の紐づけ先`);
          const empty = document.createElement("option");
          empty.value = "";
          empty.textContent = "未紐づけ";
          select.append(empty);
          for (const item of index) {
            const option = document.createElement("option");
            option.value = item.id;
            option.textContent = `${item.name} (${item.id})`;
            select.append(option);
          }
          select.value = preferredId && names.has(preferredId) ? preferredId : photo.materialId;
          const save = document.createElement("button");
          save.type = "button";
          save.textContent = photo.transfer ? "紐づけ変更を再試行" : "紐づけを保存";
          save.onclick = async () => {
            if (busy) return;
            const source = photo.transfer?.from ?? photo.materialId;
            const target = photo.transfer?.to ?? select.value;
            if (source === target) { message(status, "変更する紐づけ先を選択してください。", true); return; }
            if (source && !photo.transfer && !confirm("この画像の紐づけ先を変更します。よろしいですか？")) return;
            setBusy(true);
            try {
              await request("/photos/edit", {
                materialType, materialId: source, ...(source ? {} : { unassigned: true }),
                id: photo.id, action: "associate", targetMaterialId: target
              }, true);
              await load();
              message(status, "画像の紐づけを更新しました。");
            } catch (error) {
              console.error("[material-photos] associate", error);
              message(status, `${error.message} 一覧を更新し、未完了の場合は再試行してください。`, true);
            } finally { setBusy(false); }
          };
          const remove = document.createElement("button");
          remove.type = "button";
          remove.textContent = "画像を削除";
          remove.disabled = !!photo.transfer;
          remove.onclick = async () => {
            if (busy || !confirm("この画像を一覧から削除します。過去のバージョンは非公開の保存先に残ります。よろしいですか？")) return;
            setBusy(true);
            try {
              await request("/photos/delete", {
                materialType, materialId: photo.materialId,
                ...(photo.materialId ? {} : { unassigned: true }), id: photo.id
              }, true);
              await load();
              message(status, "画像を削除しました。");
            } catch (error) {
              console.error("[material-photos] delete", error);
              message(status, `${error.message} 一覧を更新し、削除を再試行してください。`, true);
            } finally { setBusy(false); }
          };
          if (photo.transfer) {
            const note = document.createElement("span");
            note.textContent = "紐づけ変更が未完了です。再試行してください。";
            select.disabled = true;
            card.append(note);
          }
          card.append(select, save, remove);
        }
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
      throw error;
    } finally { more.disabled = false; }
  }
  more.onclick = () => {
    if (!busy) load(!!cursor).catch(error => console.error("[material-photos] retry", error));
  };
  if (!hasSession()) {
    message(status, "画像を見るには写真用ログインが必要です。");
    loginButton(container);
  } else load().catch(error => console.error("[material-photos] initial load", error));
}
