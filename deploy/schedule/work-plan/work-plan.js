import { verifyLocalAuth } from "/common/ui.js?v=1";
import { showSaveResult } from "/common/save-modal.js?v=20261105-result-1";
import { renderHeader } from "/common/header.js?v=1.1";
import { loadCSV, normalizeKeys } from "/common/csv.js?v=20260821-quote-fix";
import { openPlanTaskModal } from "/common/work-plan-form.js?v=20261105-task-2";

const PRESIGN_URL = "https://7bx9hgk4d1.execute-api.ap-northeast-1.amazonaws.com/prod/presign";

// 作業種別（monthly-work の分類に合わせる。廃棄系は計画対象外）
export const WORK_TYPES = [
  ["seed", "播種", "tone-start"], ["nursery", "育苗", "tone-start"],
  ["tillage", "耕起", "tone-field"], ["weeding", "除草・草刈り", "tone-care"],
  ["field-maintenance", "圃場整備", "tone-field"], ["pesticide", "防除", "tone-care"],
  ["fertilizer", "施肥", "tone-care"], ["watering", "潅水", "tone-care"],
  ["hand-weeding", "手作業除草", "tone-care"], ["intertill", "中耕", "tone-field"],
  ["bedmaking", "畝立て", "tone-field"], ["planting", "定植", "tone-start"],
  ["harvest", "収穫", "tone-harvest"], ["shipping-work", "出荷", "tone-harvest"],
  ["herbicide", "除草剤散布", "tone-care"], ["cleanup", "片付け", ""], ["other", "その他", ""],
];
const TYPE_LABEL = Object.fromEntries(WORK_TYPES.map(([key, label]) => [key, label]));
const TYPE_TONE = Object.fromEntries(WORK_TYPES.map(([key, , tone]) => [key, tone]));
const WEEKDAYS = "日月火水木金土";

const element = (id) => document.getElementById(id);
let ym = "";
let data = { month: "", days: {}, memo: "" };
let dirty = false;
let canEdit = false;
let editingDate = null;
let loadReady = false;
const escape = value => String(value ?? "").replace(/[&<>"']/g,
  char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const TASK_TYPES = { ...Object.fromEntries(WORK_TYPES.map(([key, label]) => [label, key])),
  "草刈り": "weeding", "草とり": "hand-weeding" };
const taskLabel = entry => (entry.task === "出荷調整" ? "出荷" : entry.task) || TYPE_LABEL[entry.type] || entry.type;

function validateShipments(shipments) {
  if (!shipments || typeof shipments !== "object" || Array.isArray(shipments)) throw new Error("出荷予定の保存形式が不正です。");
  for (const [date, count] of Object.entries(shipments)) {
    const last = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5)), 0)).getUTCDate();
    if (!date.startsWith(`${ym}-`) || !/^\d{4}-\d{2}-\d{2}$/.test(date)
        || Number(date.slice(8)) < 1 || Number(date.slice(8)) > last
        || !Number.isSafeInteger(count) || count < 0) throw new Error("出荷予定日・基数の保存形式が不正です。");
  }
}

function status(message, isError = false) {
  element("status").textContent = message;
  element("status").classList.toggle("error", isError);
}

function setDirty() {
  dirty = true;
  status("未保存の変更があります");
}

function currentYm() {
  const param = new URLSearchParams(location.search).get("ym");
  if (param && /^\d{4}-(0[1-9]|1[0-2])$/.test(param)) return param;
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(value, diff) {
  const [y, m] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1 + diff, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function load() {
  status("読み込み中…");
  loadReady = false;
  element("save").disabled = true;
  data = { month: ym, days: {}, shipments: {}, memo: "" };
  try {
    const response = await fetch(`/data/work-plan/${ym}.json?ts=${Date.now()}`, { cache: "no-store" });
    if (response.ok) {
      const loaded = await response.json();
      validateShipments(loaded.shipments ?? {});
      data = { ...loaded, month: ym, days: loaded.days || {}, shipments: loaded.shipments ?? {}, memo: loaded.memo || "" };
    } else if (response.status !== 404) throw new Error(`月間計画を取得できません（${response.status}）。`);
    loadReady = true;
  } catch (error) {
    console.warn("work-plan load failed", error);
    element("calendar").innerHTML = "";
    status(`${error.message} 再読み込みしてください。既存データ保護のため保存できません。`, true);
    return;
  }
  element("save").disabled = false;
  dirty = false;
  element("memo").value = data.memo;
  element("month-title").textContent = `${Number(ym.slice(0, 4))}年${Number(ym.slice(5))}月`;
  render();
  status("");
}

function render() {
  const [year, mon] = ym.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const firstDow = new Date(Date.UTC(year, mon - 1, 1)).getUTCDay();
  const cells = new Array((firstDow + 6) % 7).fill(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(day);
  while (cells.length % 7) cells.push(null);

  const head = ["月", "火", "水", "木", "金", "土", "日"]
    .map((w) => `<th class="${w === "土" ? "sat" : w === "日" ? "sun" : ""}">${w}</th>`).join("");
  let rows = "";
  for (let i = 0; i < cells.length; i += 7) {
    rows += "<tr>" + cells.slice(i, i + 7).map((day) => {
      if (!day) return '<td class="empty"></td>';
      const date = `${ym}-${String(day).padStart(2, "0")}`;
      const entries = data.days[date] || [];
      // 同じ種別はまとめて表示（×件数）。詳細はツールチップで
      const groups = new Map();
      for (const entry of entries) {
        const label = taskLabel(entry);
        if (!groups.has(label)) groups.set(label, []);
        groups.get(label).push(entry);
      }
      const pills = [...groups.entries()].map(([label, list]) => {
        const type = list[0].type;
        const title = list.map((entry) => `${taskLabel(entry)}${entry.note ? "：" + entry.note : ""}`).join("、");
        const text = list.length === 1
          ? `${taskLabel(list[0])}${list[0].note ? " " + list[0].note : ""}`
          : `${label} ×${list.length}`;
        return `<span class="wp-pill ${TYPE_TONE[type] || ""}" title="${escape(title)}">${escape(text)}</span>`;
      }).join("");
      const shipment = Object.hasOwn(data.shipments || {}, date)
        ? `<span class="wp-pill tone-shipping" title="契約出荷予定 ${data.shipments[date]}基">出荷 ${data.shipments[date]}基</span>` : "";
      return `<td class="${canEdit ? "editable" : ""}" data-date="${date}"><span class="day-no">${day}</span>${shipment}${pills}</td>`;
    }).join("") + "</tr>";
  }
  element("calendar").innerHTML =
    `<table class="wp-cal"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

// ───── 日の編集ダイアログ ─────
function parkShipmentEditor() {
  element("day-dialog").insertBefore(element("shipment-editor"), element("day-error"));
}

function updateShipmentEditor() {
  const rows = [...element("day-rows").querySelectorAll(".wp-row")];
  const shipping = rows.find(row => row.dataset.type === "shipping-work");
  const editor = element("shipment-editor");
  if (shipping) shipping.appendChild(editor);
  else parkShipmentEditor();
  editor.hidden = !shipping && !Object.hasOwn(data.shipments || {}, editingDate)
    && element("shipment-count").value.trim() === "";
}

function dayRow(entry = { type: "harvest", note: "" }) {
  const row = document.createElement("div");
  row.className = "wp-row";
  row.dataset.type = entry.type;
  if (entry.type === "other" && !entry.task) row.dataset.legacyOther = "true";
  if (entry.task) row.dataset.task = entry.task;
  if (entry.src) row.dataset.src = entry.src;  // 取り込み由来（移動しても再取り込みしない）
  const last = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5)), 0)).getUTCDate();
  row.innerHTML =
    `<input type="date" class="wp-row-date" value="${editingDate}" min="${ym}-01" max="${ym}-${String(last).padStart(2, "0")}">` +
    `<button type="button" class="secondary-btn wp-task-select">${escape(taskLabel(entry) || "作業を選択")}</button>` +
    `<input type="text" class="wp-task-custom" maxlength="100" aria-label="自由入力の作業内容" placeholder="作業内容" value="${escape(entry.type === "other" ? entry.task || "" : "")}"${entry.type === "other" ? "" : " hidden"}>` +
    '<button type="button" class="danger-btn">削除</button>' +
    `<label class="wp-note-field">作業メモ<textarea class="wp-row-note" rows="3" maxlength="1000" placeholder="圃場・段取り・注意点など">${escape(entry.note)}</textarea></label>`;
  row.querySelector(".danger-btn").addEventListener("click", () => {
    parkShipmentEditor();
    row.remove();
    updateShipmentEditor();
  });
  row.querySelector(".wp-task-select").onclick = () => {
    element("day-dialog").close();
    openPlanTaskModal({
      selected: row.dataset.type === "other" ? "__custom__" : row.dataset.task
        || ({ weeding: "草刈り", "hand-weeding": "草とり" }[row.dataset.type] || TYPE_LABEL[row.dataset.type]),
      onSelect: task => {
        delete row.dataset.legacyOther;
        row.dataset.type = !task ? "" : task === "__custom__" ? "other" : TASK_TYPES[task];
        row.dataset.task = task === "__custom__" ? "" : task;
        row.querySelector(".wp-task-select").textContent = !task ? "作業を選択" : task === "__custom__" ? "その他（自由入力）" : task;
        row.querySelector(".wp-task-custom").hidden = task !== "__custom__";
        updateShipmentEditor();
      },
      onClose: () => { element("day-dialog").showModal(); row.querySelector(".wp-task-select").focus(); },
    });
  };
  return row;
}

function openDay(date) {
  if (!loadReady) return;
  editingDate = date;
  element("day-title").textContent =
    `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}` +
    `(${WEEKDAYS[new Date(date + "T00:00:00").getDay()]}) の作業・出荷予定`;
  const rows = element("day-rows");
  parkShipmentEditor();
  rows.innerHTML = "";
  for (const entry of data.days[date] || []) rows.appendChild(dayRow(entry));
  element("shipment-count").value = data.shipments?.[date] ?? "";
  updateShipmentEditor();
  element("day-error").textContent = "";
  element("day-dialog").showModal();
}

function applyDay() {
  const rawCount = element("shipment-count").value.trim();
  const count = rawCount === "" ? null : Number(rawCount);
  if ((rawCount !== "" && !/^[0-9]+$/.test(rawCount)) || (count !== null && (!Number.isSafeInteger(count) || count < 0))) {
    element("day-error").textContent = "出荷基数は0以上の整数で入力してください。空欄でこの日の出荷予定を解除します。";
    return;
  }
  const byDate = new Map();
  for (const row of element("day-rows").querySelectorAll(".wp-row")) {
    if (!row.dataset.type) continue;
    const date = row.querySelector(".wp-row-date").value || editingDate;
    const entry = {
      type: row.dataset.type,
      note: row.querySelector(".wp-row-note").value.trim(),
    };
    const task = entry.type === "other" ? row.querySelector(".wp-task-custom").value.trim() : row.dataset.task;
    if (task) entry.task = task;
    if (entry.type === "other" && !task && !row.dataset.legacyOther) {
      element("day-error").textContent = "その他の作業内容を入力してください。"; return;
    }
    if (!date.startsWith(`${ym}-`) || !row.querySelector(".wp-row-date").checkValidity()) {
      element("day-error").textContent = "作業日は表示中の月内で指定してください。"; return;
    }
    if (row.dataset.src) entry.src = row.dataset.src;
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(entry);
  }
  data.shipments ||= {};
  if (count === null) delete data.shipments[editingDate];
  else data.shipments[editingDate] = count;
  delete data.days[editingDate];
  for (const [date, entries] of byDate) {
    if (date === editingDate) data.days[date] = entries;           // この日の一覧は置き換え
    else data.days[date] = [...(data.days[date] || []), ...entries]; // 移動先には追記
  }
  element("day-dialog").close();
  setDirty();
  render();
}

// ───── 保存（既存の presign 方式で公開バケットへ） ─────
async function save() {
  if (element("save").disabled || !loadReady) return;
  element("save").disabled = true;
  try {
    status("保存中…");
    const body = JSON.stringify({
      ...data, month: ym, days: data.days, shipments: data.shipments || {}, memo: element("memo").value.trim(),
      updated_at: new Date().toISOString(),
    }, null, 1);
    const presign = await fetch(PRESIGN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: `data/work-plan/${ym}.json`, contentType: "application/json" }),
    });
    if (!presign.ok) throw new Error(`presign failed (${presign.status})`);
    const { url } = await presign.json();
    const put = await fetch(url, { method: "PUT", body,
      headers: { "Content-Type": "application/json" } });
    if (!put.ok) throw new Error(`保存に失敗しました（${put.status}）`);
    dirty = false;
    status("✅ 保存しました");
    await showSaveResult("月間作業計画を保存しました。");
  } catch (error) {
    console.error(error);
    status(`⚠ ${error.message}`, true);
    await showSaveResult(`${error.message}\n入力は残しています。保存状態を確認してから再操作してください。`);
  } finally {
    element("save").disabled = false;
  }
}

// ───── 参考データの取り込み（播種計画・定植ログ由来。確定ではなく候補として） ─────
function addDays(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

async function gatherSuggestions() {
  const suggestions = [];
  const year = Number(ym.slice(0, 4));

  // 播種計画（logs/schedule/seed/<年>.csv）→ 播種予定・定植予定
  for (const y of [year - 1, year, year + 1]) {
    const rows = normalizeKeys(await loadCSV(`/logs/schedule/seed/${y}.csv`).catch(() => []));
    for (const row of rows) {
      const variety = (row.variety || "").trim();
      const sow = (row.sowDate || row.planSowDate || "").trim();
      if (sow.startsWith(ym)) {
        suggestions.push({ date: sow, type: "seed",
          note: `${variety}${row.trayCount ? ` ${row.trayCount}枚` : ""}`.trim() });
      }
      const plant = (row.planPlantDate || "").trim();
      if (plant.startsWith(ym)) {
        suggestions.push({ date: plant, type: "planting", note: variety });
      }
    }
  }

  // 定植ログ（logs/planting/all.csv）→ 中耕の目安（定植14日目・28日目。一覧ページと同じ目安）
  const plantings = normalizeKeys(await loadCSV("/logs/planting/all.csv").catch(() => []));
  for (const row of plantings) {
    const plantDate = (row.plantDate || row.date || "").trim();
    const field = (row.field || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(plantDate) || !field) continue;
    for (const n of [14, 28]) {
      const due = addDays(plantDate, n);
      if (due.startsWith(ym)) {
        suggestions.push({ date: due, type: "intertill", note: `${field} 定植${n}日目の目安` });
      }
    }
  }

  // 既に計画に入っているもの（取り込み後に移動・編集したものも src で識別）は除く
  const seen = new Set();
  for (const [date, entries] of Object.entries(data.days)) {
    for (const entry of entries) {
      seen.add(`${date}|${entry.type}|${entry.note}`);
      if (entry.src) seen.add(entry.src);
    }
  }
  const unique = [];
  for (const s of suggestions) {
    const key = `${s.date}|${s.type}|${s.note}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(s);
  }
  unique.sort((a, b) => a.date.localeCompare(b.date) || a.type.localeCompare(b.type));
  return unique;
}

async function openImport() {
  status("予定を読み込み中…");
  let suggestions = [];
  try {
    suggestions = await gatherSuggestions();
  } catch (error) {
    console.warn("import failed", error);
  }
  status("");
  const list = element("import-list");
  if (!suggestions.length) {
    list.innerHTML = "<p class='wp-note'>この月に取り込める予定はありません（または既に計画済みです）。</p>";
  } else {
    list.innerHTML = suggestions.map((s, index) =>
      `<label class="wp-import-row"><input type="checkbox" data-index="${index}" checked>` +
      `<span>${Number(s.date.slice(5, 7))}/${Number(s.date.slice(8, 10))}` +
      `(${WEEKDAYS[new Date(s.date + "T00:00:00").getDay()]}) ` +
      `<b>${TYPE_LABEL[s.type] || s.type}</b>${s.note ? "：" + s.note : ""}</span></label>`).join("");
  }
  element("import-ok").disabled = !suggestions.length;
  element("import-dialog").showModal();
  element("import-ok").onclick = () => {
    let added = 0;
    list.querySelectorAll("input:checked").forEach((box) => {
      const s = suggestions[Number(box.dataset.index)];
      (data.days[s.date] = data.days[s.date] || []).push({
        type: s.type, note: s.note, src: `${s.date}|${s.type}|${s.note}`,
      });
      added += 1;
    });
    element("import-dialog").close();
    if (added) {
      setDirty();
      render();
      status(`📥 ${added}件を計画に追加しました（「保存する」で確定）`);
    }
  };
}

window.addEventListener("DOMContentLoaded", async () => {
  const ok = await verifyLocalAuth();
  if (!ok) return;
  renderHeader({});
  canEdit = ["family", "admin"].includes(window.currentRole);
  element("page-area").hidden = false;
  element("save").hidden = !canEdit;
  element("import-plans").hidden = !canEdit;
  element("edit-hint").hidden = !canEdit;
  element("memo").disabled = !canEdit;

  ym = currentYm();
  await load();

  element("prev-month").addEventListener("click", () => switchMonth(-1));
  element("next-month").addEventListener("click", () => switchMonth(1));
  element("save").addEventListener("click", save);
  element("import-plans").addEventListener("click", openImport);
  element("import-cancel").addEventListener("click", () => element("import-dialog").close());
  element("memo").addEventListener("input", setDirty);
  element("calendar").addEventListener("click", (event) => {
    if (!canEdit) return;
    const cell = event.target.closest("td[data-date]");
    if (cell) openDay(cell.dataset.date);
  });
  element("day-add").addEventListener("click", () => element("day-rows").appendChild(dayRow()));
  element("day-ok").addEventListener("click", applyDay);
  element("day-cancel").addEventListener("click", () => element("day-dialog").close());
  window.addEventListener("beforeunload", (event) => {
    if (dirty) event.preventDefault();
  });

  function switchMonth(diff) {
    if (dirty && !confirm("未保存の変更があります。破棄して移動しますか？")) return;
    ym = shiftMonth(ym, diff);
    history.replaceState(null, "", `?ym=${ym}`);
    load();
  }
});
