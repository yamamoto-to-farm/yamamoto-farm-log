import { verifyLocalAuth } from "/common/ui.js?v=1";
import { renderHeader } from "/common/header.js?v=1.1";

const PRESIGN_URL = "https://7bx9hgk4d1.execute-api.ap-northeast-1.amazonaws.com/prod/presign";

// 作業種別（monthly-work の分類に合わせる。廃棄系は計画対象外）
export const WORK_TYPES = [
  ["seed", "播種", "tone-start"], ["nursery", "育苗", "tone-start"],
  ["tillage", "耕起", "tone-field"], ["weeding", "除草・草刈り", "tone-care"],
  ["field-maintenance", "圃場整備", "tone-field"], ["pesticide", "防除", "tone-care"],
  ["fertilizer", "施肥", "tone-care"], ["watering", "潅水", "tone-care"],
  ["hand-weeding", "手作業除草", "tone-care"], ["intertill", "中耕", "tone-field"],
  ["bedmaking", "畝立て", "tone-field"], ["planting", "定植", "tone-start"],
  ["harvest", "収穫", "tone-harvest"], ["other", "その他", ""],
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
  data = { month: ym, days: {}, memo: "" };
  try {
    const response = await fetch(`/data/work-plan/${ym}.json?ts=${Date.now()}`, { cache: "no-store" });
    if (response.ok) {
      const loaded = await response.json();
      data = { month: ym, days: loaded.days || {}, memo: loaded.memo || "" };
    }
  } catch (error) {
    console.warn("work-plan load failed", error);
  }
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
      const pills = (data.days[date] || []).map((entry) =>
        `<span class="wp-pill ${TYPE_TONE[entry.type] || ""}" title="${TYPE_LABEL[entry.type] || entry.type}${entry.note ? "：" + entry.note : ""}">` +
        `${TYPE_LABEL[entry.type] || entry.type}${entry.note ? " " + entry.note : ""}</span>`).join("");
      return `<td class="${canEdit ? "editable" : ""}" data-date="${date}"><span class="day-no">${day}</span>${pills}</td>`;
    }).join("") + "</tr>";
  }
  element("calendar").innerHTML =
    `<table class="wp-cal"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

// ───── 日の編集ダイアログ ─────
function dayRow(entry = { type: "harvest", note: "" }) {
  const row = document.createElement("div");
  row.className = "wp-row";
  row.innerHTML =
    `<select>${WORK_TYPES.map(([key, label]) =>
      `<option value="${key}"${key === entry.type ? " selected" : ""}>${label}</option>`).join("")}</select>` +
    `<input type="text" maxlength="50" placeholder="メモ（圃場名など）" value="${(entry.note || "").replace(/"/g, "&quot;")}">` +
    '<button type="button" class="danger-btn">削除</button>';
  row.querySelector("button").addEventListener("click", () => row.remove());
  return row;
}

function openDay(date) {
  editingDate = date;
  element("day-title").textContent =
    `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}` +
    `(${WEEKDAYS[new Date(date + "T00:00:00").getDay()]}) の作業`;
  const rows = element("day-rows");
  rows.innerHTML = "";
  for (const entry of data.days[date] || []) rows.appendChild(dayRow(entry));
  element("day-dialog").showModal();
}

function applyDay() {
  const entries = [...element("day-rows").querySelectorAll(".wp-row")].map((row) => ({
    type: row.querySelector("select").value,
    note: row.querySelector("input").value.trim(),
  }));
  if (entries.length) data.days[editingDate] = entries;
  else delete data.days[editingDate];
  element("day-dialog").close();
  setDirty();
  render();
}

// ───── 保存（既存の presign 方式で公開バケットへ） ─────
async function save() {
  try {
    status("保存中…");
    const body = JSON.stringify({
      month: ym, days: data.days, memo: element("memo").value.trim(),
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
  } catch (error) {
    console.error(error);
    status(`⚠ ${error.message}`, true);
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  const ok = await verifyLocalAuth();
  if (!ok) return;
  renderHeader({});
  canEdit = ["family", "admin"].includes(window.currentRole);
  element("page-area").hidden = false;
  element("save").hidden = !canEdit;
  element("edit-hint").hidden = !canEdit;
  element("memo").disabled = !canEdit;

  ym = currentYm();
  await load();

  element("prev-month").addEventListener("click", () => switchMonth(-1));
  element("next-month").addEventListener("click", () => switchMonth(1));
  element("save").addEventListener("click", save);
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
