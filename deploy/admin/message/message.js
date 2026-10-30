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
// お休み連絡の理由の候補（自由入力も可）
const OFF_REASONS = ["雨天予報のため", "台風接近のため", "圃場の状態が悪いため", "作業の都合により"];
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
      body: "お疲れさまです。\n{月}月分の出勤簿・給与明細です。ご確認お願いします。\n"
        + "問題なければ、{翌月5日}に振込ませて頂きます。\nよろしくお願いします。" },
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
// ※文面に地図リンクは入れない（パートも農園OSの圃場マップで場所を確認できるため）
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

// 分割・統合後に、人数と作業形態（②=2人以上/③=1人）の整合を取る
function normalizeKind(card) {
  if (card.names.length > 1 && card.kind === "3") card.kind = "2";
  if (card.names.length === 1 && card.kind === "2") card.kind = "3";
  if (!card.names.some((n) => n.name === card.reporter)) {
    card.reporter = card.names[0]?.name || "";
  }
}

function addCard(names, start, end) {
  const last = lastSent()[names[0]?.name] || {};
  cards.push({
    names,
    memo: element("common-memo").value.trim(),
    off: false, offReason: OFF_REASONS[0], manualText: null,
    kind: "1", reporter: names[0]?.name || "",   // 作業形態（勤怠運用ルール第6条）と②の連絡係
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
    // 時刻は表記ゆれ（8:00 と 08:00）があるため HH:MM に正規化して比較する。
    const groups = new Map();
    for (const item of todays) {
      const key = `${toInputTime(item.start || "")}|${toInputTime(item.proposed_end || "")}`;
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
  if (card.off) {
    // 天候などによる作業中止の連絡
    const lines = ["お疲れさまです。",
      `${dateLabel(dateIso)}の作業ですが、${(card.offReason || OFF_REASONS[0]).trim()}、お休みとさせて下さい。`, ""];
    if (card.memo.trim()) {
      lines.push(card.memo.trim());
      lines.push("");
    }
    lines.push("よろしくお願いします。");
    return lines.join("\n");
  }
  const lines = ["お疲れさまです。", `${dateLabel(dateIso)}の作業予定です。`, ""];
  for (const block of card.blocks) {
    lines.push(`■ ${block.start.replace(/^0/, "")}〜${block.end.replace(/^0/, "")}`);
    if (block.field) lines.push(`・畑「${block.field}」`);
    if (block.task) lines.push(`・作業：${block.task}`);
    lines.push("");
  }
  // 作業形態②③（勤怠運用ルール第6条）：連絡係・LINE報告のお願い
  if (card.kind === "2") {
    const names = card.names.map((n) => n.name);
    const reporter = names.includes(card.reporter) ? card.reporter : names[0];
    lines.push("パートさんのみでの作業です。");
    lines.push(`連絡係は${reporter}さんにお願いします。`);
    lines.push("作業の開始・終了時（昼をまたぐ日は休憩の前後も）に、写真つきのLINE報告をお願いします。");
    lines.push("");
  } else if (card.kind === "3") {
    lines.push("1人での作業になります。");
    lines.push("作業の開始・終了時（昼をまたぐ日は休憩の前後も）に、写真つきのLINE報告をお願いします。");
    lines.push("安全に気をつけて作業をお願いします。");
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
    const offToggle = `
      <label class="off-toggle${card.off ? " on" : ""}">
        <input type="checkbox" data-c="${c}" data-k="off"${card.off ? " checked" : ""}>
        ☔ お休み連絡（中止）にする
      </label>` + (card.off
        ? `<input class="off-reason" list="dl-reasons" placeholder="理由" data-c="${c}" data-k="offReason"
                  value="${escapeHtml(card.offReason || "")}">`
        : "");
    const body = card.off ? "" : `
        <div class="kind-row">
          <select class="kind-select" data-c="${c}" data-k="kind">
            <option value="1"${card.kind === "1" ? " selected" : ""}>①家族と一緒（LINE報告なし）</option>
            <option value="2"${card.kind === "2" ? " selected" : ""}>②パートのみ（連絡係を指定）</option>
            <option value="3"${card.kind === "3" ? " selected" : ""}>③1人作業（本人が報告）</option>
          </select>
          ${card.kind === "2" ? `
          <select class="reporter-select" data-c="${c}" data-k="reporter" title="連絡係">
            ${card.names.map((n) =>
              `<option value="${escapeHtml(n.name)}"${n.name === card.reporter ? " selected" : ""}>連絡係：${escapeHtml(n.name)}</option>`).join("")}
          </select>` : ""}
        </div>
        ${blocks}
        <button type="button" class="secondary-btn add-block" data-c="${c}">＋時間帯を追加（午前/午後で畑が変わる場合）</button>`;
    return `
      <div class="msg-card${card.off ? " off" : ""}">
        <h3><span class="chip-list">${chips}</span>${merge}
          <button type="button" class="remove" data-c="${c}" title="このカードを削除">✕</button>
        </h3>
        ${hasWish ? '<p class="msg-muted">⚠ = まだ「希」のまま（未確定）</p>' : ""}
        ${offToggle}
        ${body}
        <input class="memo-input" placeholder="このグループへの一言メモ" data-c="${c}" data-k="memo"
               value="${escapeHtml(card.memo)}">
        <div class="manual-note" data-note="${c}"${card.manualText == null ? " hidden" : ""}>
          ✏ 文面を手修正中（上の入力からの自動更新は停止）
          <button type="button" class="reset-text" data-c="${c}">自動文面に戻す</button>
        </div>
        <textarea class="preview-edit" data-c="${c}" data-k="preview" rows="10"
                  spellcheck="false">${escapeHtml(card.manualText ?? buildText(card))}</textarea>
        <button type="button" class="primary-btn copy-btn" data-copy="${c}">📋 コピー（${escapeHtml(card.names.map((n) => n.name).join("・"))} へ）</button>
      </div>`;
  }).join("");
}

function refreshPreview(c) {
  const card = cards[c];
  if (card.manualText != null) return;  // 手修正中は自動更新しない
  const area = document.querySelector(`.preview-edit[data-c="${c}"]`);
  if (area) area.value = buildText(card);
}

// ───── 定型文 ─────
// 給料日＝翌月5日。土日・祝日なら前営業日に繰り上げ。
// 祝日は5日からの繰り上げで通りうる日だけを見る（1/1〜1/3・5/3〜5/5・11/3）。
function payday(now) {
  const date = new Date(now.getFullYear(), now.getMonth() + 1, 5);
  const closed = (d) => {
    const md = `${d.getMonth() + 1}/${d.getDate()}`;
    return d.getDay() === 0 || d.getDay() === 6
      || ["1/1", "1/2", "1/3", "5/3", "5/4", "5/5", "11/3"].includes(md);
  };
  while (closed(date)) date.setDate(date.getDate() - 1);
  return `${date.getMonth() + 1}/${date.getDate()}(${WEEKDAYS[date.getDay()]})`;
}

function fillPlaceholders(text) {
  const now = new Date();
  const month = now.getMonth() + 1;
  const nextMonth = (month % 12) + 1;
  const prevMonth = ((month + 10) % 12) + 1;
  return text
    .replaceAll("{年}", String(now.getFullYear()))
    .replaceAll("{月}", String(month))
    .replaceAll("{来月}", String(nextMonth))
    .replaceAll("{先月}", String(prevMonth))
    .replaceAll("{翌月5日}", payday(now));
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
                placeholder="本文（{年}{月}{先月}{来月}{翌月5日} が使えます）">${escapeHtml(tpl.body)}</textarea>
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
    if (cards.some((card) => card.manualText != null)
        && !confirm("手修正中の文面があります。手修正を破棄してメモを反映しますか？")) return;
    for (const card of cards) {
      card.memo = memo;
      card.manualText = null;
    }
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
  // 手修正中（manualText あり）に入力欄を触った場合は、確認のうえ手修正を破棄して自動文面に戻す。
  const dropManual = (c) => {
    if (cards[c].manualText == null) return true;
    if (!confirm("この文面は手修正されています。手修正を破棄して、入力からの自動文面に戻しますか？")) return false;
    cards[c].manualText = null;
    return true;
  };
  element("cards").addEventListener("input", (event) => {
    const input = event.target;
    const c = Number(input.dataset.c);
    if (!Number.isFinite(c) || !cards[c]) return;
    if (input.dataset.k === "preview") {
      cards[c].manualText = input.value;
      const note = document.querySelector(`[data-note="${c}"]`);
      if (note) note.hidden = false;
      return;
    }
    if (!dropManual(c)) {
      // 手修正を保持：入力欄を元の値へ戻す
      if (input.dataset.k === "off") input.checked = cards[c].off;
      else if (input.dataset.k === "offReason") input.value = cards[c].offReason || "";
      else if (input.dataset.k === "memo") input.value = cards[c].memo;
      else if (input.dataset.b !== undefined) {
        input.value = cards[c].blocks[Number(input.dataset.b)][input.dataset.k];
      }
      return;
    }
    if (input.dataset.k === "off") {
      cards[c].off = input.checked;
      renderCards();            // 表示構造が変わるため再描画
      return;
    }
    if (input.dataset.k === "kind") {
      cards[c].kind = input.value;
      if (!cards[c].names.some((n) => n.name === cards[c].reporter)) {
        cards[c].reporter = cards[c].names[0]?.name || "";
      }
      renderCards();            // 連絡係セレクタの表示/非表示が変わるため再描画
      return;
    }
    if (input.dataset.k === "reporter") cards[c].reporter = input.value;
    else if (input.dataset.k === "offReason") cards[c].offReason = input.value;
    else if (input.dataset.k === "memo") cards[c].memo = input.value;
    else if (input.dataset.b !== undefined) {
      cards[c].blocks[Number(input.dataset.b)][input.dataset.k] = input.value;
    }
    const note = document.querySelector(`[data-note="${c}"]`);
    if (note) note.hidden = true;
    refreshPreview(c);
  });
  // 「＋まとめる…」：選んだカードの宛先をこのカードへ統合（文面はこのカードのものを使う）
  element("cards").addEventListener("change", (event) => {
    const select = event.target.closest(".merge-select");
    if (!select || select.value === "") return;
    const dest = Number(select.dataset.c);
    const src = Number(select.value);
    const destCard = cards[dest];
    destCard.names.push(...cards[src].names);
    cards.splice(src, 1);
    normalizeKind(destCard);
    renderCards();
  });
  element("cards").addEventListener("click", async (event) => {
    const reset = event.target.closest(".reset-text");
    if (reset) {
      cards[Number(reset.dataset.c)].manualText = null;
      renderCards();
      return;
    }
    const fieldBtn = event.target.closest(".field-btn");
    if (fieldBtn) {
      const c = Number(fieldBtn.dataset.c);
      if (!dropManual(c)) return;
      const card = cards[c];
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
      const c = Number(fieldClear.dataset.c);
      if (!dropManual(c)) return;
      cards[c].blocks[Number(fieldClear.dataset.b)].field = "";
      renderCards();
      return;
    }
    const copy = event.target.closest("[data-copy]");
    if (copy) {
      const card = cards[Number(copy.dataset.copy)];
      rememberSent(card);
      await copyText(card.manualText ?? buildText(card), copy);
      return;
    }
    const addBlock = event.target.closest(".add-block");
    if (addBlock) {
      const c = Number(addBlock.dataset.c);
      if (!dropManual(c)) return;
      const card = cards[c];
      const prev = card.blocks[card.blocks.length - 1];
      card.blocks.push(newBlock("13:00", prev.end));
      renderCards();
      return;
    }
    const delBlock = event.target.closest(".del-block");
    if (delBlock) {
      const c = Number(delBlock.dataset.c);
      if (!dropManual(c)) return;
      cards[c].blocks.splice(Number(delBlock.dataset.b), 1);
      renderCards();
      return;
    }
    const chipX = event.target.closest(".chip-x");
    if (chipX) {
      // 複数人のカード → その人だけ同じ内容の別カードへ分割。ひとりなら外す。
      const card = cards[Number(chipX.dataset.c)];
      const [person] = card.names.splice(Number(chipX.dataset.n), 1);
      if (card.names.length) {
        normalizeKind(card);
        const split = { ...structuredClone(card), names: [person] };
        normalizeKind(split);
        cards.push(split);
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
