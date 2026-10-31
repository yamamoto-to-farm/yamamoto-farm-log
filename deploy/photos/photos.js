import { verifyLocalAuth } from "/common/ui.js";
import { renderHeader } from "/common/header.js";
import { config } from "./config.js";
import { clearSession, ensureToken, hasSession, login } from "./auth.js";
import { openPhotoUploadModal, makeThumbnail, postToS3 } from "./upload.js?v=20261101-1";
import { setTopPhoto } from "./top.js";
import { setupSmartBackButton } from "/common/navigation-back.js?v=1";
import { openFieldModal } from "/common/filter/filter-field.js?v=1";
import { setFilterData, filterState } from "/common/filter/filter-core.js?v=1";

const element = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const pad = value => String(value).padStart(2, "0");
const ymd = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

let fieldNames = [];
let photos = [];
let cursor = null;
let total = 0;
let current = -1;
let generation = 0;
let selectedFields = [];
let editingBusy = false;
const tops = new Map();  // 圃場名 → トップ写真ID（null=未設定）

function status(message, isError = false) {
  element("status").textContent = message;
  element("status").classList.toggle("error", isError);
}

function canManageTop() {
  return ["admin", "family"].includes(window.currentRole);
}

async function api(path, { query, body } = {}) {
  const token = await ensureToken();
  if (!token) throw new Error("写真用ログインの期限が切れました。再ログインしてください。");
  const url = `${config.api}${path}${query ? `?${new URLSearchParams(query)}` : ""}`;
  const options = { cache: "no-store", headers: { Authorization: `Bearer ${token}` } };
  if (body) {
    options.method = "POST";
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const response = await fetch(url, options);
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

function setRange(kind) {
  const today = new Date();
  let from = new Date(today);
  if (kind === "month") from = new Date(today.getFullYear(), today.getMonth(), 1);
  else if (kind === "year") from = new Date(today.getFullYear(), 0, 1);
  else if (kind === "all") from = new Date(2020, 0, 1);
  else from.setDate(from.getDate() - Number(kind));
  element("from").value = ymd(from);
  element("to").value = ymd(today);
}

function syncUrl() {
  const url = new URL(location.href);
  url.searchParams.delete("field");
  for (const field of selectedFields) url.searchParams.append("field", field);
  for (const key of ["from", "to"]) {
    const value = element(key).value;
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  history.replaceState(null, "", url);
}

function render() {
  const gallery = element("gallery");
  gallery.replaceChildren();
  photos.forEach((photo, index) => {
    const card = document.createElement("article");
    card.className = "photo-card";
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", `${photo.field} ${photo.takenOn}の写真を拡大`);
    const image = document.createElement("img");
    image.src = photo.thumbUrl || photo.url;  // 一覧はサムネイル（旧写真は本画像）
    image.alt = photo.note || `${photo.field}の写真`;
    image.decoding = "async";
    if (index < 6) {
      image.fetchPriority = "high";           // 最初に見える分を優先して取得
    } else {
      image.loading = "lazy";
    }
    image.referrerPolicy = "no-referrer";
    image.addEventListener("error", () => {
      status("画像を読み込めません。「検索」を押して更新してください（URLの有効期間は15分です）。", true);
    });
    button.append(image);
    button.addEventListener("click", () => openViewer(index));
    const meta = document.createElement("div");
    meta.className = "photo-card-meta";
    const title = document.createElement("strong");
    title.textContent = photo.field;
    const date = document.createElement("span");
    date.textContent = photo.takenOn.replaceAll("-", "/");
    meta.append(title, date);
    if (photo.note) {
      const note = document.createElement("div");
      note.className = "photo-card-note";
      note.textContent = photo.note;
      meta.append(note);
    }
    card.append(button, meta);
    gallery.append(card);
  });
  applyTopBadges();
  element("more").hidden = !cursor;
}

// ★トップ写真バッジ：表示中の圃場ぶんだけトップ設定を取得して反映する
function applyTopBadges() {
  document.querySelectorAll("#gallery .photo-card").forEach((card, index) => {
    const photo = photos[index];
    card.classList.toggle("is-top", !!photo && tops.get(photo.field) === photo.id);
  });
}

async function updateTopBadges() {
  const missing = [...new Set(photos.map(photo => photo.field))].filter(field => !tops.has(field));
  // 同時リクエストを絞って取得する（一斉に投げるとコールドスタート時に503が出やすい）
  for (let index = 0; index < missing.length; index += 4) {
    await Promise.all(missing.slice(index, index + 4).map(async field => {
      try {
        const result = await api("/photos/top", { query: { field } });
        tops.set(field, result.photo?.id || null);
      } catch {
        // 取得失敗はバッジなしで続行（次回の検索で再取得する）
      }
    }));
  }
  applyTopBadges();
}

// 前回の検索結果（署名URLは15分有効なので10分以内なら即表示に使える）
const CACHE_KEY = "photos-last-result";
const CACHE_TTL_MS = 10 * 60 * 1000;

function searchKey() {
  return JSON.stringify({ fields: [...selectedFields].sort(), from: element("from").value, to: element("to").value });
}

function writeCache() {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({
      key: searchKey(), at: Date.now(), photos, cursor, total,
    }));
  } catch { /* 容量超過などは無視 */ }
}

function readCache() {
  try {
    const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY));
    if (cached && cached.key === searchKey() && Date.now() - cached.at < CACHE_TTL_MS) return cached;
  } catch { /* 破損時は無視 */ }
  return null;
}

async function load(append = false) {
  const from = element("from").value;
  const to = element("to").value;
  if (!from || !to) {
    status("開始日と終了日を指定してください。", true);
    return;
  }
  if (from > to) {
    status("開始日は終了日以前にしてください。", true);
    return;
  }
  const requestGeneration = ++generation;
  status("写真を読み込み中…");
  const query = { from, to };
  if (selectedFields.length) query.fields = JSON.stringify(selectedFields);
  if (append && cursor) query.cursor = cursor;
  const result = await api("/photos/search", { query });
  if (requestGeneration !== generation) return;
  if (!Array.isArray(result.photos)) throw new Error("写真一覧の応答が不正です。");
  photos = append ? [...photos, ...result.photos] : result.photos;
  cursor = result.cursor || null;
  total = result.total ?? photos.length;
  writeCache();
  render();
  updateTopBadges().catch(() => { /* バッジは任意表示 */ });
  status(photos.length ? `${total}枚中 ${photos.length}枚を表示中` : "条件に合う写真はありません。");
}

function search() {
  syncUrl();
  photos = [];
  cursor = null;
  render();
  return load().catch(report);
}

function report(error) {
  console.error("[photos]", error);
  status(error.message, true);
  element("login-area").hidden = hasSession();
}

function openViewer(index) {
  current = index;
  const photo = photos[index];
  const full = element("full-image");
  if (photo.thumbUrl) {
    // サムネイルを即表示し、フル画像が届いたら差し替える（体感高速化）
    full.src = photo.thumbUrl;
    const loader = new Image();
    loader.onload = () => { if (current === index && element("viewer").open) full.src = photo.url; };
    loader.src = photo.url;
  } else {
    full.src = photo.url;
  }
  full.alt = photo.note || `${photo.field}の写真`;
  element("caption").textContent = [`${photo.field}　${photo.takenOn.replaceAll("-", "/")}`, photo.note].filter(Boolean).join("\n");
  element("position").textContent = `${index + 1} / ${photos.length}${cursor ? "+" : ""}`;
  element("prev").disabled = index === 0;
  element("next").disabled = index === photos.length - 1 && !cursor;
  element("set-top").hidden = !canManageTop();
  element("set-top").disabled = tops.get(photo.field) === photo.id;
  element("set-top").textContent = tops.get(photo.field) === photo.id ? "★ トップ写真です" : "★ トップ写真にする";
  element("delete").hidden = !photo.canDelete;
  element("edit-photo").hidden = !photo.canEdit;
  element("photo-edit-form").hidden = true;
  element("open-diary").href = `/diary/index.html?mode=view&date=${photo.takenOn}`;
  viewerStatus("");
  if (!element("viewer").open) element("viewer").showModal();
}

function viewerStatus(message, isError = false) {
  element("viewer-status").textContent = message;
  element("viewer-status").classList.toggle("error", isError);
}

async function step(delta) {
  if (editingBusy || !element("photo-edit-form").hidden) return;
  const next = current + delta;
  if (next < 0) return;
  if (next >= photos.length) {
    if (!cursor) return;
    try { await load(true); } catch (error) { viewerStatus(error.message, true); return; }
  }
  if (next < photos.length) openViewer(next);
}

async function removeCurrent() {
  const photo = photos[current];
  if (!photo || !window.confirm(`${photo.field} ${photo.takenOn} の写真を削除します。元に戻せません。よろしいですか？`)) return;
  element("delete").disabled = true;
  try {
    await api("/photos/delete", { body: { field: photo.field, id: photo.id } });
    photos.splice(current, 1);
    total = Math.max(0, total - 1);
    render();
    status(`削除しました（${total}枚）。`);
    if (!photos.length) element("viewer").close();
    else openViewer(Math.min(current, photos.length - 1));
  } catch (error) {
    viewerStatus(error.message, true);
  } finally {
    element("delete").disabled = false;
  }
}

// 既存写真のサムネイル一括生成：検索結果のうちサムネが無いものを順に
// 「フル画像を取得 → ブラウザで縮小 → サムネ保存（POST /photos/thumb）」する。
let backfilling = false;
async function backfillThumbs() {
  if (backfilling) return;
  const targets = () => photos.filter(photo => !photo.thumbUrl);
  if (!targets().length && !cursor) {
    status("表示中の写真はすべてサムネイル済みです。期間を「全期間」にして再検索すると他も確認できます。");
    return;
  }
  if (!confirm("表示中の検索結果（続きも含む）のサムネイルを生成します。枚数が多いと時間がかかります。よろしいですか？")) return;
  backfilling = true;
  const button = element("backfill-thumbs");
  button.disabled = true;
  let done = 0;
  let failed = 0;
  try {
    while (cursor) await load(true);  // 検索結果の続きも読み込んで対象にする
    const list = targets();
    for (const photo of list) {
      status(`サムネイルを生成中… ${done + failed + 1}/${list.length}`);
      try {
        const image = await fetch(photo.url, { cache: "no-store" });
        if (!image.ok) throw new Error(`画像取得に失敗（${image.status}）`);
        const thumb = await makeThumbnail(await image.blob());
        if (!thumb) throw new Error("縮小に失敗");
        const ticket = await api("/photos/thumb", { body: { field: photo.field, id: photo.id } });
        const put = await postToS3(ticket.upload, thumb);
        if (!put.ok) throw new Error(`保存に失敗（${put.status}）`);
        await api("/photos/thumb", { body: { field: photo.field, id: photo.id, done: 1 } });
        done += 1;
      } catch (error) {
        console.error("[photos] thumb backfill failed", photo.id, error);
        failed += 1;
      }
    }
    status(`サムネイル生成が完了しました（成功 ${done}枚・失敗 ${failed}枚）。`,
           failed > 0);
  } finally {
    backfilling = false;
    button.disabled = false;
  }
}

async function makeTop() {
  const photo = photos[current];
  try {
    await setTopPhoto(photo.field, photo.id);
    tops.set(photo.field, photo.id);
    applyTopBadges();
    element("set-top").disabled = true;
    element("set-top").textContent = "★ トップ写真です";
    viewerStatus(`「${photo.field}」のトップ写真に設定しました。`);
  } catch (error) {
    viewerStatus(error.message, true);
  }
}

function startEditing() {
  const photo = photos[current];
  if (!photo?.canEdit) return;
  element("edit-taken-on").value = photo.takenOn;
  element("edit-note").value = photo.note || "";
  element("photo-edit-form").hidden = false;
  viewerStatus("");
  element("edit-note").focus();
}

async function saveEditing(event) {
  event.preventDefault();
  if (editingBusy) return;
  const photo = photos[current];
  if (!photo?.canEdit) return;
  editingBusy = true;
  const controls = [...element("viewer").querySelectorAll("button, input, textarea")];
  const previous = controls.map(control => control.disabled);
  controls.forEach(control => { control.disabled = true; });
  let saved = false;
  try {
    viewerStatus("変更を保存しています…");
    await api("/photos/edit", { body: {
      field: photo.field, id: photo.id,
      takenOn: element("edit-taken-on").value, note: element("edit-note").value
    } });
    saved = true;
    element("photo-edit-form").hidden = true;
    element("viewer").close();
    await load();
    status("写真のメモ・撮影日を更新しました。");
  } catch (error) {
    console.error("[photos] edit failed", error);
    if (saved) {
      report(new Error(`変更は保存されましたが、一覧を更新できませんでした。「検索」で更新してください。 ${error.message}`));
    } else {
      viewerStatus(error.message, true);
    }
  } finally {
    editingBusy = false;
    controls.forEach((control, index) => { control.disabled = previous[index]; });
  }
}

function setFields(names) {
  selectedFields = [...new Set(names)];
  filterState.fields = selectedFields.slice();
  element("field-selected").textContent = selectedFields.length
    ? selectedFields.join("、")
    : "すべての圃場";
  element("clear-field-btn").hidden = !selectedFields.length;
}

function bind() {
  element("search").addEventListener("click", search);
  element("open-field-modal").addEventListener("click", () => {
    filterState.fields = selectedFields.slice();
    openFieldModal({ mode: "filter", includeExpired: true }).catch(report);
  });
  window.addEventListener("filter:apply", () => {
    setFields(filterState.fields);
    search();
  });
  element("clear-field-btn").addEventListener("click", () => {
    setFields([]);
    search();
  });
  for (const button of document.querySelectorAll("[data-range]")) {
    button.addEventListener("click", () => {
      setRange(button.dataset.range);
      search();
    });
  }
  element("more").addEventListener("click", async () => {
    element("more").disabled = true;
    try { await load(true); } catch (error) { report(error); }
    finally { element("more").disabled = false; }
  });
  element("add").addEventListener("click", () => openPhotoUploadModal({
    pickFromAll: true,
    initialField: selectedFields.length === 1 ? selectedFields[0] : "",
    getDate: () => ymd(new Date()),
    onUploaded: () => search()
  }));
  element("login").addEventListener("click", () => login(location.pathname + location.search).catch(report));
  element("backfill-thumbs").addEventListener("click", () => backfillThumbs().catch(report));
  element("prev").addEventListener("click", () => step(-1));
  element("next").addEventListener("click", () => step(1));
  element("close-viewer").addEventListener("click", () => element("viewer").close());
  element("viewer").addEventListener("close", () => element("full-image").removeAttribute("src"));
  element("set-top").addEventListener("click", makeTop);
  element("edit-photo").addEventListener("click", startEditing);
  element("photo-edit-form").addEventListener("submit", saveEditing);
  element("cancel-edit").addEventListener("click", () => {
    element("photo-edit-form").hidden = true;
    viewerStatus("");
  });
  element("viewer").addEventListener("cancel", event => {
    if (editingBusy) event.preventDefault();
  });
  element("delete").addEventListener("click", removeCurrent);
  element("viewer").addEventListener("keydown", event => {
    if (event.key === "ArrowLeft") step(-1);
    if (event.key === "ArrowRight") step(1);
  });
}

async function init() {
  if (!(await verifyLocalAuth())) return;
  renderHeader();
  setupSmartBackButton({ elementId: "photos-back-btn", fallbackPath: "/index.html" });
  element("page-area").hidden = false;
  bind();
  const response = await fetch("/data/fields.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`圃場一覧を読み込めません（${response.status}）。`);
  fieldNames = (await response.json());
  const parents = [];
  const children = {};
  for (const field of fieldNames) {
    if (!field.name) continue;
    if (!children[field.area]) {
      children[field.area] = [];
      parents.push(field.area);
    }
    children[field.area].push(field.name);
  }
  setFilterData({ fields: { parents, children } });
  fieldNames = fieldNames.map(field => field.name).filter(Boolean);
  setFields(params.getAll("field").filter(Boolean));
  setRange("30");
  if (params.get("from")) element("from").value = params.get("from");
  if (params.get("to")) element("to").value = params.get("to");
  if (!hasSession()) {
    status("写真を見るには写真用ログインが必要です。");
    element("login-area").hidden = false;
    return;
  }
  element("backfill-thumbs").hidden = !canManageTop();
  // 10分以内の同じ条件の結果があれば即表示し、裏で最新に更新する
  const cached = readCache();
  if (cached) {
    photos = cached.photos;
    cursor = cached.cursor;
    total = cached.total;
    render();
    updateTopBadges().catch(() => { /* バッジは任意表示 */ });
    status("前回の結果を表示中（最新に更新しています…）");
  }
  await load();
}

init().catch(report);
