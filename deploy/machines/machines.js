import { verifyLocalAuth } from "/common/ui.js?v=1";
import { renderHeader } from "/common/header.js?v=1";
import { showSaveResult } from "/common/save-modal.js?v=20261105-result-1";
import { config } from "/photos/config.js";
import { ensureToken } from "/photos/auth.js?v=20261029-2";

const el = id => document.getElementById(id);
const escape = value => String(value ?? "").replace(/[&<>"']/g,
  char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const labels = { manual: "取扱説明書", operation: "操作メモ", setting: "目盛り・調整の控え" };
let state = null;
let machineId = "";
let loading = false;
let busy = false;
let editing = null;
let attached = [];
let selectedFiles = [];
let editorSnapshot = "";

export async function machineApi(action, data = {}) {
  const token = await ensureToken();
  if (!token) throw new Error("ログインし直してから機械資料を開いてください。");
  const query = new URLSearchParams(data);
  const response = await fetch(`${config.api}/machines${action ? "" : query.size ? `?${query}` : ""}`, {
    method: action ? "POST" : "GET", cache: "no-store",
    headers: { Authorization: `Bearer ${token}`, ...(action ? { "Content-Type": "application/json" } : {}) },
    ...(action ? { body: JSON.stringify({ ...data, action }) } : {}),
  });
  let value;
  try { value = await response.json(); }
  catch { throw new Error(`機械資料APIの応答を確認できません（${response.status}）。配置・接続を確認してください。`); }
  if (!response.ok) throw new Error(value.message || `機械資料APIでエラーが発生しました（${response.status}）。`);
  return value;
}

export function validRecord(value) {
  return value && typeof value.canEdit === "boolean" && value.machine?.id === machineId
    && (value.revision === null || typeof value.revision === "string")
    && value.record?.machineId === machineId && Array.isArray(value.record.entries)
    && value.record.assets && typeof value.record.assets === "object"
    && value.record.entries.every(entry => entry && typeof entry.id === "string"
      && Object.hasOwn(labels, entry.kind) && typeof entry.title === "string"
      && typeof entry.body === "string" && typeof entry.url === "string"
      && typeof entry.updatedAt === "string" && Array.isArray(entry.attachments)
      && entry.attachments.every(id => typeof id === "string" && value.record.assets[id]
        && typeof value.record.assets[id].name === "string"));
}

function status(message, error = false, editor = false) {
  const target = el(editor ? "entry-status" : "machine-status");
  target.textContent = message;
  target.classList.toggle("error", error);
}

export function safeLink(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function formatTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "更新日時不明" : date.toLocaleString("ja-JP");
}

function render() {
  const query = el("machine-search").value.trim().toLocaleLowerCase();
  if (!machineId) {
    const machines = state.machines.filter(item => `${item.id} ${item.name}`.toLocaleLowerCase().includes(query));
    el("machine-list").innerHTML = machines.map(item =>
      `<a class="machine-card" href="./detail.html?machine=${encodeURIComponent(item.id)}"><strong>${escape(item.name)}</strong><small>${escape(item.id)}</small></a>`
    ).join("") || "<p>該当する機械はありません。</p>";
    return;
  }
  const entries = state.record.entries.filter(entry => `${entry.title} ${entry.body}`.toLocaleLowerCase().includes(query));
  el("machine-record").innerHTML = Object.entries(labels).map(([kind, label]) => {
    const items = entries.filter(entry => entry.kind === kind);
    return `<section><h2>${label}</h2>${items.map(entry =>
      `<article class="machine-entry"><h3>${escape(entry.title)}</h3>
        <p class="machine-meta">${kind === "manual" ? "登録資料" : "農園独自メモ"} ／ 更新：${escape(formatTime(entry.updatedAt))}</p>
        <div class="machine-body">${escape(entry.body)}</div>
        ${safeLink(entry.url) ? `<p><a href="${escape(safeLink(entry.url))}" target="_blank" rel="noopener noreferrer">外部の資料を開く</a></p>` : ""}
        <ul>${entry.attachments.map(id => `<li><button type="button" class="secondary-btn machine-file" data-file="${escape(id)}">${escape(state.record.assets[id].name)} を開く</button></li>`).join("")}</ul>
        ${state.canEdit ? `<div class="machine-actions"><button type="button" class="secondary-btn" data-edit="${escape(entry.id)}">編集</button><button type="button" class="secondary-btn" data-delete="${escape(entry.id)}">資料を削除</button></div>` : ""}
      </article>`).join("") || "<p>資料はありません。</p>"}</section>`;
  }).join("");
}

async function load() {
  if (busy || loading) return;
  loading = true;
  el("machine-reload").disabled = true;
  status("機械資料を読み込み中…");
  try {
    const value = await machineApi(null, machineId ? { machine: machineId } : {});
    if (machineId) {
      if (!validRecord(value)) throw new Error("機械資料の応答形式が不正です。");
      el("machine-title").textContent = `${value.machine.name}｜資料・メモ`;
      el("machine-tools").hidden = !value.canEdit;
      const link = el("machine-work");
      link.href = `/machine-work-hub.html?machine=${encodeURIComponent(machineId)}`;
      link.hidden = false;
    } else if (!Array.isArray(value.machines) || !value.machines.every(item =>
      typeof item?.id === "string" && typeof item.name === "string")) {
      throw new Error("機械一覧の応答形式が不正です。");
    }
    state = value;
    render();
    status("");
  } catch (error) {
    console.error("[machines] load failed", error);
    status(`${error.message}「再読み込み」で再試行してください。`, true);
  } finally { loading = false; el("machine-reload").disabled = false; }
}

function editorValue() {
  return JSON.stringify([el("entry-kind").value, el("entry-title").value, el("entry-body").value,
    el("entry-url").value, attached, selectedFiles.map(file => [file.name, file.size, file.lastModified])]);
}

function renderAttachments() {
  el("entry-attachments").innerHTML = attached.map(id =>
    `<li>${escape(state.record.assets[id]?.name || id)} <button type="button" class="secondary-btn" data-remove-asset="${escape(id)}">添付を外す</button></li>`
  ).join("") + selectedFiles.map((file, index) =>
    `<li>${escape(file.name)}（保存時にアップロード） <button type="button" class="secondary-btn" data-remove-file="${index}">外す</button></li>`).join("");
}

function openEditor(entry = null) {
  if (busy || loading || !state?.canEdit) return;
  editing = entry?.id || crypto.randomUUID();
  attached = [...(entry?.attachments || [])];
  selectedFiles = [];
  el("machine-form").reset();
  el("entry-kind").value = entry?.kind || "operation";
  el("entry-title").value = entry?.title || "";
  el("entry-body").value = entry?.body || "";
  el("entry-url").value = entry?.url || "";
  status("", false, true);
  renderAttachments();
  editorSnapshot = editorValue();
  el("machine-editor").showModal();
}

function closeEditor() {
  if (busy) return;
  if (editorValue() !== editorSnapshot && !confirm("入力中の資料を破棄しますか？")) return;
  el("machine-editor").close();
}

export function checkFiles(files, existingCount) {
  if (files.length + existingCount > 10) throw new Error("添付は1資料10件までです。");
  for (const file of files) {
    const max = file.type === "application/pdf" ? 20 * 1024 * 1024
      : ["image/jpeg", "image/png"].includes(file.type) ? 10 * 1024 * 1024 : 0;
    if (!max || file.size < 1 || file.size > max || file.name.length > 150) {
      throw new Error("PDFは20MB、JPEG・PNGは10MB以内、ファイル名は150文字以内で指定してください。");
    }
  }
}

async function upload(file) {
  const issued = await machineApi("upload", { machine: machineId, name: file.name, size: file.size, type: file.type });
  if (typeof issued.id !== "string" || !safeLink(issued.upload?.url) || !issued.upload?.fields) {
    throw new Error("アップロード先の応答が不正です。");
  }
  const form = new FormData();
  Object.entries(issued.upload.fields).forEach(([key, value]) => form.append(key, value));
  form.append("file", file);
  const response = await fetch(issued.upload.url, { method: "POST", body: form });
  if (!response.ok) throw new Error(`ファイルのアップロードに失敗しました（${response.status}）。`);
  const asset = await machineApi("complete", { machine: machineId, id: issued.id });
  if (asset.id !== issued.id || typeof asset.name !== "string") throw new Error("添付の確定結果が不正です。");
  state.record.assets[asset.id] = asset;
  return asset.id;
}

function setBusy(value) {
  busy = value;
  el("machine-inputs").disabled = value;
  el("entry-save").disabled = value;
  el("entry-cancel").disabled = value;
  el("machine-reload").disabled = value;
  el("machine-add").disabled = value;
}

async function saveEditor(event) {
  event.preventDefault();
  if (busy || !state?.canEdit) return;
  const title = el("entry-title").value.trim();
  const body = el("entry-body").value.trim();
  const url = el("entry-url").value.trim();
  if (!title || (!body && !url && !attached.length && !selectedFiles.length)) {
    status("タイトルと、本文・リンク・添付のいずれかを入力してください。", true, true); return;
  }
  if (url && !safeLink(url)) { status("資料リンクはhttps URLを指定してください。", true, true); return; }
  setBusy(true);
  try {
    checkFiles(selectedFiles, attached.length);
    while (selectedFiles.length) {
      status(`アップロード中：${selectedFiles[0].name}`, false, true);
      attached.push(await upload(selectedFiles[0]));
      selectedFiles.shift();
      renderAttachments();
    }
    const entry = { id: editing, kind: el("entry-kind").value, title, body, url, attachments: [...attached] };
    const entries = state.record.entries.filter(item => item.id !== editing);
    const index = state.record.entries.findIndex(item => item.id === editing);
    entries.splice(index < 0 ? entries.length : index, 0, entry);
    status("資料を保存中…", false, true);
    await machineApi("save", { machine: machineId, revision: state.revision, entries });
    const latest = await machineApi(null, { machine: machineId });
    if (!validRecord(latest)) throw new Error("保存後の取得結果が不正です。");
    state = latest;
    render();
    el("machine-editor").close();
    status("資料を保存しました。");
    await showSaveResult("資料を保存しました。");
  } catch (error) {
    console.error("[machines] save failed", error);
    status(`${error.message} 入力は残しています。保存結果が不明な場合は入力を控え、閉じて再読み込みしてください。`, true, true);
    await showSaveResult(el("entry-status").textContent);
  } finally { setBusy(false); }
}

async function removeEntry(id) {
  if (busy || loading || !state?.canEdit) return;
  const entry = state.record.entries.find(item => item.id === id);
  if (!entry || !confirm(`「${entry.title}」を資料一覧から削除しますか？添付の実体は非公開保管に残ります。`)) return;
  setBusy(true);
  try {
    await machineApi("save", { machine: machineId, revision: state.revision,
      entries: state.record.entries.filter(item => item.id !== id) });
    const latest = await machineApi(null, { machine: machineId });
    if (!validRecord(latest)) throw new Error("削除後の取得結果が不正です。");
    state = latest;
    render();
    status("資料を一覧から削除しました。");
    await showSaveResult("資料を一覧から削除しました。");
  } catch (error) {
    console.error("[machines] delete failed", error);
    status(`${error.message} 再操作の前に再読み込みして保存状態を確認してください。`, true);
    await showSaveResult(el("machine-status").textContent);
  } finally { setBusy(false); }
}

async function openFile(id) {
  const popup = window.open("about:blank", "_blank");
  if (!popup) { status("新しい画面がブロックされました。ポップアップを許可して再試行してください。", true); return; }
  popup.opener = null;
  try {
    const result = await machineApi("file", { machine: machineId, id });
    if (!safeLink(result.url)) throw new Error("添付URLの応答が不正です。");
    popup.location.replace(result.url);
  } catch (error) {
    popup.close();
    console.error("[machines] file failed", error);
    status(error.message, true);
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  if (!await verifyLocalAuth()) return;
  renderHeader();
  el("machine-area").hidden = false;
  const detail = !!el("machine-record");
  machineId = detail ? new URLSearchParams(location.search).get("machine") || "" : "";
  if (detail && !machineId) { status("機械IDがありません。「機械一覧へ」から選択してください。", true); return; }
  el("machine-reload").onclick = load;
  el("machine-search").oninput = () => { if (state) render(); };
  if (detail) {
    el("machine-add").onclick = () => openEditor();
    el("machine-form").onsubmit = saveEditor;
    el("entry-cancel").onclick = closeEditor;
    el("machine-editor").addEventListener("cancel", event => { event.preventDefault(); closeEditor(); });
    el("entry-files").onchange = event => {
      try {
        const files = [...selectedFiles, ...event.target.files];
        checkFiles(files, attached.length);
        selectedFiles = files;
        renderAttachments();
        status("", false, true);
      } catch (error) { status(error.message, true, true); }
      event.target.value = "";
    };
    el("entry-attachments").onclick = event => {
      if (busy) return;
      const asset = event.target.closest("[data-remove-asset]");
      const file = event.target.closest("[data-remove-file]");
      if (asset) attached = attached.filter(id => id !== asset.dataset.removeAsset);
      if (file) selectedFiles.splice(Number(file.dataset.removeFile), 1);
      renderAttachments();
    };
    el("machine-record").onclick = event => {
      const file = event.target.closest("[data-file]");
      const edit = event.target.closest("[data-edit]");
      const remove = event.target.closest("[data-delete]");
      if (file) void openFile(file.dataset.file);
      if (edit) openEditor(state.record.entries.find(entry => entry.id === edit.dataset.edit));
      if (remove) void removeEntry(remove.dataset.delete);
    };
    window.addEventListener("beforeunload", event => {
      if (busy || (el("machine-editor").open && editorValue() !== editorSnapshot)) {
        event.preventDefault(); event.returnValue = "";
      }
    });
  }
  await load();
});
