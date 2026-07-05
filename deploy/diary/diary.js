// =========================================================
// diary/diary.js — 閲覧／編集モード切り替え対応（権限は window.currentRole）
// =========================================================

import { verifyLocalAuth } from "/common/ui.js";
import { renderHeader } from "/common/header.js";
import { showWorkSummary, loadLogsByDate, extractWorkForEdit, searchLogsByKeyword } from "./work-summary.js";
import { initEditPage } from "./editCard.js";
import { initViewPage } from "./viewCard.js";
import { saveDiary } from "./saveDiary.js";
import { renderWeatherBox } from "./weather-box.js";
import { initCollapse } from "/common/collapse.js";

const SEARCH_LIMIT = 80;

function shiftDateByDays(dateStr, diffDays) {
  if (!dateStr) return "";
  const base = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(base.getTime())) return dateStr;
  base.setDate(base.getDate() + diffDays);
  const y = base.getFullYear();
  const m = String(base.getMonth() + 1).padStart(2, "0");
  const d = String(base.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ---------------------------------------------------------
// モード切り替えボタン描画（★ 日付を URL に保持）
// ---------------------------------------------------------
function renderModeSwitch(mode, keyword = "") {
  const area = document.getElementById("modeSwitchArea");
  if (!area) return;

  const date = document.getElementById("diaryDate").value;
  const modeUrlView = buildDiaryUrl("view", date, keyword);
  const modeUrlEdit = buildDiaryUrl("edit", date, keyword);
  const ym = date ? date.slice(0, 7) : "";
  const monthUrl = ym
    ? `/schedule/monthly-work/index.html?mode=around2&ym=${ym}`
    : "/schedule/monthly-work/index.html?mode=latest4";

  let rightButtons = `
    <button class="mode-btn ${mode === "view" ? "active" : ""}"
            onclick="location.href='${modeUrlView}'">
      閲覧モード
    </button>
  `;

  if (window.currentRole === "admin") {
    rightButtons += `
      <button class="mode-btn ${mode === "edit" ? "active" : ""}"
              onclick="location.href='${modeUrlEdit}'">
        編集モード
      </button>
    `;
  }

  area.innerHTML = `
    <div class="mode-switch-left">
      <button class="mode-btn" onclick="location.href='${monthUrl}'">
        作業カレンダー
      </button>
      <div class="diary-search-bar">
        <input id="diarySearchInput" class="form-input diary-search-input" type="search" placeholder="作業者・圃場・作業種別で検索" value="${escapeAttr(keyword)}">
        <button id="diarySearchBtn" type="button" class="secondary-btn mode-btn">検索</button>
        <button id="diarySearchClearBtn" type="button" class="secondary-btn mode-btn">クリア</button>
      </div>
    </div>
    <div class="mode-switch-right">
      ${rightButtons}
    </div>
  `;
}

function buildDiaryUrl(mode, date, keyword = "") {
  const params = new URLSearchParams();
  params.set("mode", mode);
  if (date) params.set("date", date);
  if (keyword) params.set("q", keyword);
  return `index.html?${params.toString()}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/\n/g, " ");
}

function renderSearchResult(result) {
  const date = escapeHtml(result.date || "-");
  const type = escapeHtml(result.displayName || "-");
  const field = escapeHtml(result.field || "-");
  const worker = escapeHtml(result.worker || "-");
  const snippet = escapeHtml(result.snippet || "");

  return `
    <li>
      <button type="button" class="diary-search-item" data-date="${date}">
        <div class="diary-search-item-head">
          <span class="diary-search-date">${date}</span>
          <span class="diary-search-type">${type}</span>
          <span class="diary-search-meta">圃場: ${field}</span>
          <span class="diary-search-meta">作業者: ${worker}</span>
        </div>
        ${snippet ? `<div class="diary-search-snippet">${snippet}</div>` : ""}
      </button>
    </li>
  `;
}

function renderSearchState(keyword, result) {
  const summary = document.getElementById("diarySearchSummary");
  const box = document.getElementById("diarySearchResults");
  if (!summary || !box) return;

  if (!keyword) {
    summary.style.display = "none";
    box.style.display = "none";
    box.innerHTML = "";
    return;
  }

  summary.style.display = "block";
  summary.textContent = `「${keyword}」の検索結果: ${result.total}件（最大${SEARCH_LIMIT}件まで表示）`;

  box.style.display = "block";
  if (!result.hits.length) {
    box.innerHTML = `<p class="diary-search-empty">該当する作業ログはありません。</p>`;
    return;
  }

  box.innerHTML = `<ul class="diary-search-list">${result.hits.map(renderSearchResult).join("")}</ul>`;
}

function bindSearchEvents({ mode, dateInput }) {
  const input = document.getElementById("diarySearchInput");
  const searchBtn = document.getElementById("diarySearchBtn");
  const clearBtn = document.getElementById("diarySearchClearBtn");
  const resultsBox = document.getElementById("diarySearchResults");
  if (!input || !searchBtn || !clearBtn || !resultsBox) return;

  const performSearch = async () => {
    const keyword = input.value.trim();
    history.replaceState({}, "", buildDiaryUrl(mode, dateInput.value, keyword));

    if (!keyword) {
      renderSearchState("", { total: 0, hits: [] });
      return;
    }

    renderSearchState(keyword, { total: 0, hits: [] });
    const result = await searchLogsByKeyword(keyword, { limit: SEARCH_LIMIT });
    renderSearchState(keyword, result);
  };

  searchBtn.addEventListener("click", () => {
    void performSearch();
  });

  clearBtn.addEventListener("click", () => {
    input.value = "";
    history.replaceState({}, "", buildDiaryUrl(mode, dateInput.value, ""));
    renderSearchState("", { total: 0, hits: [] });
  });

  input.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      void performSearch();
    }
  });

  if (!resultsBox.dataset.boundSearchJump) {
    resultsBox.dataset.boundSearchJump = "1";
    resultsBox.addEventListener("click", e => {
      const btn = e.target.closest(".diary-search-item");
      if (!btn) return;

      const date = String(btn.dataset.date || "");
      if (!date) return;

      dateInput.value = date;
      dateInput.dispatchEvent(new Event("change"));
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }
}

// ---------------------------------------------------------
// メイン処理
// ---------------------------------------------------------
window.addEventListener("DOMContentLoaded", async () => {

  // 認証（true/false）
  const ok = await verifyLocalAuth();
  if (!ok) return;

  // URL パラメータ
  const params = new URLSearchParams(location.search);
  const mode = params.get("mode") || "view";
  const urlDate = params.get("date");
  const urlQuery = (params.get("q") || "").trim();

  // ★ admin 以外は編集モード禁止
  if (mode === "edit" && window.currentRole !== "admin") {
    location.href = "index.html?mode=view";
    return;
  }

  // ヘッダー描画
  renderHeader();

  // ページ表示
  document.getElementById("form-area").style.display = "block";

  // ★ 日付セット（URL の date を優先）
  const today = new Date().toISOString().slice(0, 10);
  const initialDate = urlDate || today;

  const dateInput = document.getElementById("diaryDate");
  const prevDayBtn = document.getElementById("prevDayBtn");
  const nextDayBtn = document.getElementById("nextDayBtn");
  dateInput.value = initialDate;

  if (prevDayBtn) {
    prevDayBtn.addEventListener("click", () => {
      dateInput.value = shiftDateByDays(dateInput.value, -1);
      dateInput.dispatchEvent(new Event("change"));
    });
  }

  if (nextDayBtn) {
    nextDayBtn.addEventListener("click", () => {
      dateInput.value = shiftDateByDays(dateInput.value, 1);
      dateInput.dispatchEvent(new Event("change"));
    });
  }

  // モード切り替えボタン描画（★ initialDate を反映）
  renderModeSwitch(mode, urlQuery);
  bindSearchEvents({ mode, dateInput });

  // 天気カード表示
  await renderWeatherBox(initialDate);

  // 作業ログ一覧表示
  await showWorkSummary(initialDate);

  if (urlQuery) {
    const result = await searchLogsByKeyword(urlQuery, { limit: SEARCH_LIMIT });
    renderSearchState(urlQuery, result);
  }

  // ▼ 折りたたみ（作業ログ一覧）
  initCollapse("workListTitle", "workList");

  // モード別カード表示
  if (mode === "edit") {
    await initEditPage();
  } else {
    await initViewPage();
  }

  // ---------------------------------------------------------
  // 保存イベント（編集モードのみ）
  // ---------------------------------------------------------
  const saveBtn = document.getElementById("saveDiaryBtn");

  if (mode === "edit") {
    saveBtn.style.display = "block";

    saveBtn.addEventListener("click", async () => {
      const date = dateInput.value;

      const logs = await loadLogsByDate(date);
      const autoList = extractWorkForEdit(logs);

      saveDiary(date, autoList);
    });

  } else {
    saveBtn.style.display = "none";
  }

  // ---------------------------------------------------------
  // 日付変更イベント
  // ---------------------------------------------------------
  dateInput.addEventListener("change", async e => {
    const d = e.target.value;

    // 天気カード更新
    await renderWeatherBox(d);

    // 作業ログ一覧更新
    await showWorkSummary(d);

    // ▼ 折りたたみ再適用
    initCollapse("workListTitle", "workList");

    // モード別カード更新
    if (mode === "edit") {
      await initEditPage();
    } else {
      await initViewPage();
    }

    // ★ モード切り替えボタンも更新（新しい日付を反映）
    const currentSearch = document.getElementById("diarySearchInput")?.value?.trim() || "";
    renderModeSwitch(mode, currentSearch);
    bindSearchEvents({ mode, dateInput });
    history.replaceState({}, "", buildDiaryUrl(mode, d, currentSearch));
  });
  // (印刷時の一時処理は削除されました)
});
