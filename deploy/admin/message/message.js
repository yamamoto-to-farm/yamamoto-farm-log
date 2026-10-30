// 業務連絡（LINE下書き）ページ
// シフト（人ごとの確定時刻）と作業計画から「明日の作業予定」の文面を作り、コピーしてLINEへ貼る。
// 毎月の定型文（シフト入力のお願い等）もここで選んでコピーできる。自動送信はしない。
// 畑は他のログページと共通の圃場モーダル（data/fields.json）、作業内容は作業ログの種別＋手入力。
import { verifyLocalAuth } from "/common/ui.js";
import { renderHeader } from "/common/header.js?v=1.1";
import { config } from "/photos/config.js";
import { ensureToken, hasSession, login } from "/photos/auth.js?v=20261029-2";
import { openFieldModal } from "/common/filter/filter-field.js?v=1";
import { getFilterData, setFilterData } from "/common/filter/filter-core.js?v=1";
import {
  applyAdjustments, defaultScenarioIndex, fitRemaining, toInputTime,
} from "/admin/shift/shift-logic.js?v=20261030-36";

const PRESIGN_URL = "https://7bx9hgk4d1.execute-api.ap-northeast-1.amazonaws.com/prod/presign";
const MASTERS_KEY = "data/message/masters.json";
const WEEKDAYS = "日月火水木金土";
const WORK_LABELS = {
  seed: "播種", nursery: "育苗", tillage: "耕起", weeding: "除草", "field-maintenance": "圃場整備",
  pesticide: "防除", fertilizer: "施肥", watering: "潅水", "hand-weeding": "手除草",
  intertill: "中耕", bedmaking: "畝立て", planting: "定植", harvest: "収穫", other: "その他",
};
// 作業内容の候補（作業ログの種別。自由入力も可）
const TASK_OPTIONS = ["収穫", "播種", "育苗", "定植", "耕起", "中耕", "畝立て", "除草・草刈り",
  "手作業除草", "防除", "施肥", "潅水", "圃場整備", "出荷調整", "片付け"];
const DEFAULT_TEMPLATES = [
    { title: "シフト入力のお願い",
      body: "お疲れさまです。\n{来月}月の勤務希望の入力をお願いします。\n"
        + "いつものカレンダー（TimeTree）に、タイトル「希」付きで入力してください"
        + "（例：希　終日、希　〜15:00）。\n25日ごろまでにお願いします。" },
    { title: "シフト確定のお知らせ",
      body: "お疲れさまです。\n{来月}月のシフトをカレンダー（TimeTree）に反映しました。\n"
        + "「希」が付いていない予定が確定分です。ご確認をお願いします。\n"
        + "※「希」のまま残っている日は、作業の様子を見て3日前までに連絡します。" },
    { title: "出勤簿の確認",
      body: "お疲れさまです。\n{月}月分の出勤簿をお送りします。\n"
        + "内容をご確認いただき、間違いがあればご連絡ください。\nよろしくお願いします。" },
];

const element = (id) => document.getElementById(id);
let masters = { templates: structuredClone(DEFAULT_TEMPLATES) };
let fieldsData = [];         // data/fields.json（共通の圃場マスタ。地図リンクは緯度経度から生成）
let tplDraft = [];           // 定型文の編集用ドラフト
let cards = [];              // 宛先グループ [{names:[{name,wish}], memo, blocks:[{start,end,field,task}]}]
let workPlan = null;
let canEdit = false;

function status(message, isError = false) {
  element("status").textContent = message;
  element("status").classList.toggle("error", isError);
}

// ───── 共通 ─────
async function api(path, query) {
  const token = await ensureToken();
  if (!token) throw new Error("ログインの期限が切れました。再ログインしてください。");
  const url = `${config.api}${path}${query ? `?${new URLSearchParams(query)}` : ""}`;
  const response = await fetch(url, { cache: "no-store", headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    let message = `エラー（${response.status}）`;
    try { message = `${(await response.json()).message}（${response.status}）`; } catch { /* 本文なし */ }
    throw new Error(message);
  }
  return response.json();
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  const original = button.textContent;
  button.textContent = "✓ コピーしました";
  button.classList.add("copied");
  setTimeout(() => { button.textContent = original; button.classList.remove("copied"); }, 1600);
}

// ───── マスタ ─────
async function loadMasters() {
  try {
    const response = await fetch(`/${MASTERS_KEY}?ts=${Date.now()}`, { cache: "no-store" });
    if (response.ok) {
      const loaded = await response.json();
      if (Array.isArray(loaded.templates) && loaded.templates.length) {
        masters.templates = loaded.templates;
      }
    }
  } catch { /* 未作成なら既定値のまま */ }
}

// 共通の圃場マスタ（data/fields.json）を読み、圃場モーダル用のツリーを登録する
async function loadFields() {
  try {
    const response = await fetch(`/data/fields.json?ts=${Date.now()}`, { cache: "no-store" });
    fieldsData = response.ok ? await response.json() : [];
  } catch {
    fieldsData = [];
  }
  const byArea = new Map();
  for (const f of fieldsData) {
    const area = String(f?.area || "").trim();
    const name = String(f?.name || "").trim();
    if (!area || !name) continue;
    if (!byArea.has(area)) byArea.set(area, []);
    if (!byArea.get(area).includes(name)) byArea.get(area).push(name);
  }
  setFilterData({
    ...(getFilterData() || {}),
    fields: { parents: [...byArea.keys()], children: Object.fromEntries(byArea) },
  });
}

// 地図リンク（緯度経度から生成）
function mapLinkFor(fieldName) {
  const field = fieldsData.find((f) => f.name === fieldName);
  return field && field.lat && field.lng ? `https://www.google.com/maps?q=${field.lat},${field.lng}` : "";
}

async function saveMasters() {
  status("保存中…");
  const body = JSON.stringify({ templates: masters.templates, updated_at: new Date().toISOString() }, null, 1);
  const presign = await fetch(PRESIGN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: MASTERS_KEY, contentType: "application/json" }),
  });
  if (!presign.ok) throw new Error(`presign failed (${presign.status})`);
  const { url } = await presign.json();
  const put = await fetch(url, { method: "PUT", body, headers: { "Content-Type": "application/json" } });
  if (!put.ok) throw new Error(`保存に失敗しました (${put.status})`);
  status("保存しました。");
}

function renderDatalists() {
  element("dl-tasks").innerHTML = TASK_OPTIONS
    .map((t) => `<option value="${escapeHtml(t)}"></option>`).join("");
}

// ───── 作業連絡 ─────
function todayIso(offsetDays = 0) {
  const now = new Date();
  now.setDate(now.getDate() + offsetDays);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function dateLabel(dateIso) {
  if (dateIso === todayIso(1)) return "明日";
  if (dateIso === todayIso(0)) return "今日";
  const [y, m, d] = dateIso.split("-").map(Number);
  const dow = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  return `${m}/${d}（${dow}）`;
}

function lastSent() {
  try { return JSON.parse(localStorage.getItem("message-last")) || {}; } catch { return {}; }
}

function rememberSent(card) {
  const data = lastSent();
  for (const n of card.names) {
    data[n.name] = { field: card.blocks[0]?.field || "", task: card.blocks[0]?.task || "" };
  }
  try { localStorage.setItem("message-last", JSON.stringify(data)); } catch { /* 無視 */ }
}

function newBlock(start = "08:00", end = "15:00") {
  return { start, end, field: "", task: "" };
}

function addCard(names, start, end) {
  const last = lastSent()[names[0]?.name] || {};
  cards.push({
    names,
    memo: element("common-memo").value.trim(),
    blocks: [{ start: start || "08:00", end: end || "15:00", field: last.field || "", task: last.task || "" }],
  });
}

async function loadFromShift() {
  const dateIso = element("msg-date").value;
  if (!dateIso) return;
  if (!hasSession()) {
    element("msg-login").hidden = false;
    element("shift-state").textContent = "シフト連携にはログインが必要です（手動で人を追加もできます）";
    return;
  }
  element("shift-state").textContent = "読み込み中…";
  const month = dateIso.slice(0, 7);
  try {
    const plan = await api("/shift/plan", { month });
    let edits = { overrides: {}, base: null, autofit: false };
    try {
      const result = await api("/shift/edits", { month });
      Object.assign(edits, result.data || {});
    } catch { /* 編集なし */ }
    const scenario = plan.scenarios[defaultScenarioIndex(plan)];
    let eff = applyAdjustments(plan, scenario, edits.overrides || {}, edits.base || null);
    if (edits.autofit) eff = fitRemaining(plan, eff, scenario.budget_max, edits.base || null).items;
    const todays = eff.filter((item) => item.date === dateIso
      && item.status !== "hold" && item.status !== "skip" && item.proposed_hours > 0);
    // 時間帯が同じ人はひとつのカード（同じ文面）にまとめる。作業が違う場合は後から分割できる。
    const groups = new Map();
    for (const item of todays) {
      const key = `${item.start || ""}|${item.proposed_end || ""}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    cards = [];
    for (const items of groups.values()) {
      addCard(items.map((item) => ({ name: item.person, wish: item.status === "extra" })),
              toInputTime(items[0].start || ""), toInputTime(items[0].proposed_end || ""));
    }
    element("shift-state").textContent = todays.length
      ? `シフトから ${todays.length}人（${cards.length}グループ）を読み込みました`
      : "この日の勤務予定はありません（＋人を追加 で手動作成できます）";
  } catch (error) {
    element("shift-state").textContent = "";
    status(error.message, true);
  }
  await loadWorkPlanHints(dateIso);
  renderCards();
}

async function loadWorkPlanHints(dateIso) {
  const month = dateIso.slice(0, 7);
  workPlan = await fetch(`/data/work-plan/${month}.json?ts=${Date.now()}`, { cache: "no-store" })
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null);
  const works = workPlan?.days?.[dateIso] || [];
  const hints = element("wp-hints");
  if (!works.length) { hints.hidden = true; hints.innerHTML = ""; return; }
  hints.hidden = false;
  hints.innerHTML = "📋 この日の作業計画："
    + works.map((w) => {
      const label = `${WORK_LABELS[w.type] || w.type}${w.note ? `：${w.note}` : ""}`;
      return `<button type="button" class="wp-chip" data-task="${escapeHtml(label)}">${escapeHtml(label)}</button>`;
    }).join("")
    + '<span class="msg-muted">（クリックで空欄の作業内容に入れます）</span>';
}

function buildText(card) {
  const dateIso = element("msg-date").value;
  const lines = ["お疲れさまです。", `${dateLabel(dateIso)}の作業予定です。`, ""];
  for (const block of card.blocks) {
    lines.push(`■ ${block.start.replace(/^0/, "")}〜${block.end.replace(/^0/, "")}`);
    if (block.field) {
      lines.push(`・畑「${block.field}」`);
      const map = mapLinkFor(block.field);
      if (map) lines.push(`・地図：${map}`);
    }
    if (block.task) lines.push(`・作業：${block.task}`);
    lines.push("");
  }
  if (card.memo.trim()) {
    lines.push(card.memo.trim());
    lines.push("");
  }
  lines.push("よろしくお願いします。");
  return lines.join("\n");
}

function renderCards() {
  const container = element("cards");
  if (!cards.length) {
    container.innerHTML = '<p class="msg-muted">「🔄 シフトから読み込み」か「＋人を追加」で作成します。</p>';
    return;
  }
  container.innerHTML = cards.map((card, c) => {
    const blocks = card.blocks.map((block, b) => `
      <div class="msg-block">
        <input type="time" data-c="${c}" data-b="${b}" data-k="start" value="${block.start}">
        <span class="tilde">〜</span>
        <input type="time" data-c="${c}" data-b="${b}" data-k="end" value="${block.end}">
        <div class="block-row2">
          <button type="button" class="field-btn${block.field ? " set" : ""}" data-c="${c}" data-b="${b}">
            ${block.field ? `🗺 ${escapeHtml(block.field)}` : "畑を選択"}</button>
          ${block.field ? `<button type="button" class="field-clear" data-c="${c}" data-b="${b}" title="畑をクリア">✕</button>` : ""}
          <input list="dl-tasks" placeholder="作業内容" data-c="${c}" data-b="${b}" data-k="task"
                 value="${escapeHtml(block.task)}">
          ${card.blocks.length > 1
            ? `<button type="button" class="del-block" data-c="${c}" data-b="${b}" title="この時間帯を削除">✕</button>`
            : ""}
        </div>
      </div>`).join("");
    const chips = card.names.map((n, i) =>
      `<span class="name-chip">${escapeHtml(n.name)}${n.wish ? " ⚠" : ""}` +
      `<button type="button" class="chip-x" data-c="${c}" data-n="${i}"` +
      ` title="${card.names.length > 1 ? "別の文面に分ける" : "この人を外す"}">✕</button></span>`).join("");
    const mergeOptions = cards
      .map((other, i) => (i === c ? "" :
        `<option value="${i}">${escapeHtml(other.names.map((n) => n.name).join("・"))}</option>`))
      .join("");
    const merge = cards.length > 1
      ? `<select class="merge-select" data-c="${c}"><option value="">＋まとめる…</option>${mergeOptions}</select>`
      : "";
    const hasWish = card.names.some((n) => n.wish);
    return `
      <div class="msg-card">
        <h3><span class="chip-list">${chips}</span>${merge}
          <button type="button" class="remove" data-c="${c}" title="このカードを削除">✕</button>
        </h3>
        ${hasWish ? '<p class="msg-muted">⚠ = まだ「希」のまま（未確定）</p>' : ""}
        ${blocks}
        <button type="button" class="secondary-btn add-block" data-c="${c}">＋時間帯を追加（午前/午後で畑が変わる場合）</button>
        <input class="memo-input" placeholder="このグループへの一言メモ" data-c="${c}" data-k="memo"
               value="${escapeHtml(card.memo)}">
        <pre data-preview="${c}">${escapeHtml(buildText(card))}</pre>
        <button type="button" class="primary-btn copy-btn" data-copy="${c}">📋 コピー（${escapeHtml(card.names.map((n) => n.name).join("・"))} へ）</button>
      </div>`;
  }).join("");
}

function refreshPreview(c) {
  const pre = document.querySelector(`[data-preview="${c}"]`);
  if (pre) pre.textContent = buildText(cards[c]);
}

// ───── 定型文 ─────
function fillPlaceholders(text) {
  const now = new Date();
  const month = now.getMonth() + 1;
  const nextMonth = (month % 12) + 1;
  return text
    .replaceAll("{年}", String(now.getFullYear()))
    .replaceAll("{月}", String(month))
    .replaceAll("{来月}", String(nextMonth));
}

function renderTemplates() {
  element("template-list").innerHTML = masters.templates.map((tpl, i) => `
    <div class="tpl">
      <h3>${escapeHtml(tpl.title)}</h3>
      <pre>${escapeHtml(fillPlaceholders(tpl.body))}</pre>
      <button type="button" class="primary-btn" data-tpl-copy="${i}">📋 コピー</button>
    </div>`).join("");
}

function renderTemplateEditor() {
  element("template-edit").innerHTML = tplDraft.map((tpl, i) => `
    <div class="tpl-edit">
      <input data-tpl="${i}" data-k="title" value="${escapeHtml(tpl.title)}" placeholder="タイトル">
      <textarea data-tpl="${i}" data-k="body" rows="6"
                placeholder="本文（{年}{月}{来月} が使えます）">${escapeHtml(tpl.body)}</textarea>
      <button type="button" class="del-tpl" data-tpl-del="${i}">この定型文を削除</button>
    </div>`).join("");
}

// ───── 初期化 ─────
window.addEventListener("DOMContentLoaded", async () => {
  const ok = await verifyLocalAuth();
  if (!ok) return;
  if (!["admin", "family"].includes(window.currentRole)) {
    alert("このページは admin / family のみアクセスできます");
    location.href = "/index.html";
    return;
  }
  renderHeader({ adminPage: true });
  canEdit = true;
  element("page-area").hidden = false;
  element("msg-date").value = todayIso(1);  // 既定は明日

  await Promise.all([loadMasters(), loadFields()]);
  renderDatalists();
  tplDraft = structuredClone(masters.templates);
  renderTemplates();
  renderTemplateEditor();
  renderCards();
  if (hasSession()) loadFromShift();
  else element("msg-login").hidden = false;

  // タブ切り替え
  document.querySelectorAll(".msg-tab").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".msg-tab").forEach((b) => b.classList.toggle("on", b === button));
      for (const name of ["daily", "templates"]) {
        element(`tab-${name}`).hidden = name !== button.dataset.tab;
      }
    });
  });

  element("msg-login").addEventListener("click", () => login("/admin/message/index.html"));
  element("msg-date").addEventListener("change", () => loadFromShift());
  element("load-shift").addEventListener("click", () => loadFromShift());
  element("add-person").addEventListener("click", () => {
    const name = prompt("名前を入力してください");
    if (!name || !name.trim()) return;
    addCard([{ name: name.trim(), wish: false }]);
    renderCards();
  });
  element("apply-memo").addEventListener("click", () => {
    const memo = element("common-memo").value.trim();
    for (const card of cards) card.memo = memo;
    renderCards();
  });

  // 作業計画チップ → 空欄の作業内容へ
  element("wp-hints").addEventListener("click", (event) => {
    const chip = event.target.closest(".wp-chip");
    if (!chip) return;
    for (const card of cards) {
      for (const block of card.blocks) {
        if (!block.task) block.task = chip.dataset.task;
      }
    }
    renderCards();
  });

  // カードの編集（入力は状態へ反映し、プレビューだけ書き換える）
  element("cards").addEventListener("input", (event) => {
    const input = event.target;
    const c = Number(input.dataset.c);
    if (!Number.isFinite(c) || !cards[c]) return;
    if (input.dataset.k === "memo") cards[c].memo = input.value;
    else if (input.dataset.b !== undefined) {
      cards[c].blocks[Number(input.dataset.b)][input.dataset.k] = input.value;
    }
    refreshPreview(c);
  });
  // 「＋まとめる…」：選んだカードの宛先をこのカードへ統合（文面はこのカードのものを使う）
  element("cards").addEventListener("change", (event) => {
    const select = event.target.closest(".merge-select");
    if (!select || select.value === "") return;
    const dest = Number(select.dataset.c);
    const src = Number(select.value);
    cards[dest].names.push(...cards[src].names);
    cards.splice(src, 1);
    renderCards();
  });
  element("cards").addEventListener("click", async (event) => {
    const fieldBtn = event.target.closest(".field-btn");
    if (fieldBtn) {
      const card = cards[Number(fieldBtn.dataset.c)];
      const block = card.blocks[Number(fieldBtn.dataset.b)];
      openFieldModal({
        mode: "select",
        selectWithConfirm: true,
        selectedField: block.field,
        onSelect: (name) => {
          block.field = String(name || "").trim();
          renderCards();
        },
      });
      return;
    }
    const fieldClear = event.target.closest(".field-clear");
    if (fieldClear) {
      cards[Number(fieldClear.dataset.c)].blocks[Number(fieldClear.dataset.b)].field = "";
      renderCards();
      return;
    }
    const copy = event.target.closest("[data-copy]");
    if (copy) {
      const card = cards[Number(copy.dataset.copy)];
      rememberSent(card);
      await copyText(buildText(card), copy);
      return;
    }
    const addBlock = event.target.closest(".add-block");
    if (addBlock) {
      const card = cards[Number(addBlock.dataset.c)];
      const prev = card.blocks[card.blocks.length - 1];
      card.blocks.push(newBlock("13:00", prev.end));
      renderCards();
      return;
    }
    const delBlock = event.target.closest(".del-block");
    if (delBlock) {
      cards[Number(delBlock.dataset.c)].blocks.splice(Number(delBlock.dataset.b), 1);
      renderCards();
      return;
    }
    const chipX = event.target.closest(".chip-x");
    if (chipX) {
      // 複数人のカード → その人だけ同じ内容の別カードへ分割。ひとりなら外す。
      const card = cards[Number(chipX.dataset.c)];
      const [person] = card.names.splice(Number(chipX.dataset.n), 1);
      if (card.names.length) {
        cards.push({ names: [person], memo: card.memo, blocks: structuredClone(card.blocks) });
      } else {
        cards.splice(Number(chipX.dataset.c), 1);
      }
      renderCards();
      return;
    }
    const remove = event.target.closest(".remove");
    if (remove) {
      cards.splice(Number(remove.dataset.c), 1);
      renderCards();
    }
  });

  // 定型文
  element("template-list").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-tpl-copy]");
    if (!button) return;
    await copyText(fillPlaceholders(masters.templates[Number(button.dataset.tplCopy)].body), button);
  });
  element("template-edit").addEventListener("input", (event) => {
    const input = event.target;
    const i = Number(input.dataset.tpl);
    if (Number.isFinite(i) && tplDraft[i]) tplDraft[i][input.dataset.k] = input.value;
  });
  element("template-edit").addEventListener("click", (event) => {
    const del = event.target.closest("[data-tpl-del]");
    if (!del) return;
    tplDraft.splice(Number(del.dataset.tplDel), 1);
    renderTemplateEditor();
  });
  element("add-template").addEventListener("click", () => {
    tplDraft.push({ title: "新しい定型文", body: "" });
    renderTemplateEditor();
  });
  element("save-templates").addEventListener("click", async () => {
    masters.templates = tplDraft.filter((tpl) => tpl.title.trim() || tpl.body.trim());
    try {
      await saveMasters();
      renderTemplates();
    } catch (error) {
      status(error.message, true);
    }
  });
});
