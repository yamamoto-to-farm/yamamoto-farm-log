// =========================================================
// diary/diary.js — 閲覧／編集モード切り替え対応（権限は window.currentRole）
// =========================================================

import { verifyLocalAuth } from "/common/ui.js";
import { renderHeader } from "/common/header.js";
import { loadLogsByDate, showWorkSummary, searchLogsByKeyword } from "./work-summary.js";
import { initEditPage } from "./editCard.js";
import { initViewPageWithOptions } from "./viewCard.js";
import { saveDiary } from "./saveDiary.js";
import { loadDiaryByDate } from "./loadDiary.js";
import { renderWeatherBox } from "./weather-box.js";
import { initCollapse } from "/common/collapse.js";
import { loadJSON } from "/common/json.js";

const SEARCH_LIMIT = 80;
const DIARY_SEARCH_LIMIT = 40;
const DIARY_BLOCK_DAYS = 90;
const MAX_DIARY_SEARCH_DAYS = 720;

let diaryIndexDatesCache = null;
let activeSearchState = null;
let isEditPageLoading = false;
let isDiarySaving = false;

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

function getTodayJstDateString() {
  const now = new Date();
  const jst = new Date(now.getTime() + (9 * 60 + now.getTimezoneOffset()) * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(jst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseYmdToDate(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd || ""))) return null;
  const dt = new Date(`${ymd}T00:00:00`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function renderMonthMiniCalendar(selectedDate, savedDatesSet) {
  const host = document.getElementById("diaryMonthMini");
  if (!host) return;

  const selected = parseYmdToDate(selectedDate);
  if (!selected) {
    host.innerHTML = "";
    return;
  }

  const year = selected.getFullYear();
  const month = selected.getMonth();
  const firstDay = new Date(year, month, 1);
  const firstWeekday = firstDay.getDay();
  const lastDate = new Date(year, month + 1, 0).getDate();
  const selectedDay = Number(selectedDate.slice(8, 10));
  const labels = ["日", "月", "火", "水", "木", "金", "土"];
  const ym = selectedDate.slice(0, 7);

  const cells = [];
  labels.forEach(label => {
    cells.push(`<div class="diary-month-mini-cell is-label">${label}</div>`);
  });

  for (let i = 0; i < firstWeekday; i += 1) {
    cells.push('<div class="diary-month-mini-cell is-empty"></div>');
  }

  for (let d = 1; d <= lastDate; d += 1) {
    const ymd = `${ym}-${String(d).padStart(2, "0")}`;
    const classes = ["diary-month-mini-cell"];
    if (savedDatesSet.has(ymd)) classes.push("has-entry");
    if (d === selectedDay) classes.push("is-selected");
    cells.push(`<div class="${classes.join(" ")}">${d}</div>`);
  }

  host.innerHTML = `
    <div class="diary-month-mini-head">${year}年${month + 1}月（保存日の印付き）</div>
    <div class="diary-month-mini-grid">${cells.join("")}</div>
    <div class="diary-month-mini-legend">青背景: 保存済み日 / 枠線: 選択中の日付</div>
  `;
}

async function refreshDiaryMonthMini(selectedDate) {
  const dates = await loadDiaryIndexDates();
  renderMonthMiniCalendar(selectedDate, new Set(dates));
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
  const editLogUrl = buildEditLogUrl(date);
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
      <button class="mode-btn" onclick="location.href='${editLogUrl}'">
        作業ログ編集へ
      </button>
    `;
  }

  area.innerHTML = `
    <div class="mode-switch-left">
      <button class="mode-btn" onclick="location.href='${monthUrl}'">
        作業カレンダー
      </button>
    </div>
    <div class="mode-switch-right">
      ${rightButtons}
    </div>
  `;
}

function buildEditLogUrl(date) {
  const params = new URLSearchParams();
  if (date) params.set("date", date);
  params.set("mode", "date");
  return `/admin/edit-log/index.html?${params.toString()}`;
}

function buildDiaryUrl(mode, date, keyword = "") {
  const params = new URLSearchParams();
  params.set("mode", mode);
  if (date) params.set("date", date);
  if (keyword) params.set("q", keyword);
  return `index.html?${params.toString()}`;
}

function normalizeToken(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function formatDateYmd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function buildRangeStartDate(anchorDate, days) {
  const base = new Date(`${anchorDate}T00:00:00`);
  if (Number.isNaN(base.getTime())) return anchorDate;
  base.setDate(base.getDate() - (days - 1));
  return formatDateYmd(base);
}

async function loadDiaryIndexDates() {
  if (diaryIndexDatesCache) return diaryIndexDatesCache;

  try {
    const index = await loadJSON("/data/diary-index.json");
    const allDates = [];
    Object.values(index || {}).forEach(value => {
      if (Array.isArray(value)) {
        value.forEach(v => allDates.push(String(v || "").trim()));
      }
    });

    diaryIndexDatesCache = Array.from(new Set(allDates))
      .filter(v => /^\d{4}-\d{2}-\d{2}$/.test(v))
      .sort((a, b) => b.localeCompare(a));
  } catch {
    diaryIndexDatesCache = [];
  }

  return diaryIndexDatesCache;
}

async function canLoadMoreDiaryRange(anchorDate, searchedDays) {
  const indexDates = await loadDiaryIndexDates();
  if (indexDates.length) {
    const currentStart = buildRangeStartDate(anchorDate, searchedDays);
    return indexDates.some(date => date < currentStart);
  }

  return searchedDays < MAX_DIARY_SEARCH_DAYS;
}

function buildDiarySearchText(diary) {
  const parts = [String(diary?.memo || "")];
  const works = Array.isArray(diary?.work) ? diary.work : [];
  works.forEach(w => {
    parts.push(String(w?.type || w?.workType || ""));
    parts.push(Array.isArray(w?.field) ? w.field.join("/") : String(w?.field || ""));
    parts.push(Array.isArray(w?.workers) ? w.workers.join("/") : String(w?.workers || ""));
    parts.push(String(w?.machine || ""));
    parts.push(String(w?.start || ""));
    parts.push(String(w?.end || ""));
  });

  return normalizeToken(parts.join(" "));
}

function summarizeDiaryMeta(diary) {
  const works = Array.isArray(diary?.work) ? diary.work : [];
  const types = Array.from(new Set(works.map(w => String(w?.type || w?.workType || "").trim()).filter(Boolean)));
  const workers = [];
  const fields = [];

  works.forEach(w => {
    const ws = Array.isArray(w?.workers) ? w.workers : [w?.workers];
    ws.map(v => String(v || "").trim()).filter(Boolean).forEach(v => workers.push(v));

    const fs = Array.isArray(w?.field) ? w.field : [w?.field];
    fs.map(v => String(v || "").trim()).filter(Boolean).forEach(v => fields.push(v));
  });

  return {
    type: types[0] || "日誌",
    worker: Array.from(new Set(workers)).slice(0, 3).join("／"),
    field: Array.from(new Set(fields)).slice(0, 3).join("／")
  };
}

function buildDiarySnippet(diary) {
  const memo = String(diary?.memo || "").trim();
  if (memo) return memo.length > 80 ? `${memo.slice(0, 80)}...` : memo;

  const works = Array.isArray(diary?.work) ? diary.work : [];
  if (!works.length) return "";

  const first = works[0] || {};
  const firstType = String(first?.type || first?.workType || "").trim();
  const firstMachine = String(first?.machine || "").trim();
  const joined = [firstType, firstMachine].filter(Boolean).join(" / ");
  return joined;
}

async function searchDiaryJsonByKeywordRange(keyword, anchorDate, startOffsetDays, spanDays) {
  const query = normalizeToken(keyword);
  if (!query || !anchorDate) {
    return {
      total: 0,
      hits: [],
      rangeStart: "",
      rangeEnd: anchorDate || ""
    };
  }

  const rangeEnd = shiftDateByDays(anchorDate, -Math.max(0, startOffsetDays));
  const rangeStart = buildRangeStartDate(rangeEnd, spanDays);
  let candidates = await loadDiaryIndexDates();

  if (!candidates.length) {
    candidates = Array.from({ length: spanDays }, (_, i) => shiftDateByDays(rangeEnd, -i));
  }

  const targetDates = candidates
    .filter(date => date >= rangeStart && date <= anchorDate)
    .sort((a, b) => b.localeCompare(a));

  const hits = [];
  for (const date of targetDates) {
    const diary = await loadDiaryByDate(date);
    if (!diary) continue;

    const searchText = buildDiarySearchText(diary);
    if (!searchText.includes(query)) continue;

    const meta = summarizeDiaryMeta(diary);
    hits.push({
      source: "diary",
      date,
      displayName: `日誌: ${meta.type || "日誌"}`,
      field: meta.field,
      worker: meta.worker,
      snippet: buildDiarySnippet(diary)
    });

    if (hits.length >= DIARY_SEARCH_LIMIT) break;
  }

  return {
    total: hits.length,
    hits,
    rangeStart,
    rangeEnd
  };
}

async function searchAllSources(keyword, anchorDate, searchedDays) {
  const diaryStartOffset = Math.max(0, searchedDays - DIARY_BLOCK_DAYS);
  const [logResult, diaryResult] = await Promise.all([
    searchLogsByKeyword(keyword, { limit: SEARCH_LIMIT }),
    searchDiaryJsonByKeywordRange(keyword, anchorDate, diaryStartOffset, DIARY_BLOCK_DAYS)
  ]);

  const hasMoreDiaryRange = await canLoadMoreDiaryRange(anchorDate, searchedDays);

  const combinedHits = [...logResult.hits, ...diaryResult.hits]
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
    .slice(0, SEARCH_LIMIT);

  return {
    total: logResult.total + diaryResult.total,
    logTotal: logResult.total,
    diaryTotal: diaryResult.total,
    hits: combinedHits,
    anchorDate,
    searchDays: searchedDays,
    rangeStart: buildRangeStartDate(anchorDate, searchedDays),
    rangeEnd: anchorDate,
    hasMoreDiaryRange
  };
}

function mergeByDateAndSource(baseHits, extraHits) {
  const map = new Map();
  [...baseHits, ...extraHits].forEach(hit => {
    const key = `${hit.source || "log"}#${hit.date || ""}#${hit.displayName || ""}#${hit.snippet || ""}`;
    if (!map.has(key)) map.set(key, hit);
  });

  return [...map.values()].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
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
  const sourceLabel = result.source === "diary" ? "日誌JSON" : "作業ログ";

  return `
    <li>
      <button type="button" class="diary-search-item" data-date="${date}">
        <div class="diary-search-item-head">
          <span class="diary-search-date">${date}</span>
          <span class="diary-search-source">${sourceLabel}</span>
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
  summary.textContent = `「${keyword}」: 合計${result.total}件（作業ログ ${result.logTotal}件 / 日誌JSON ${result.diaryTotal}件） 起点 ${result.anchorDate} から前${result.searchDays}日 (${result.rangeStart}〜${result.rangeEnd})`;

  box.style.display = "block";
  if (!result.hits.length) {
    box.innerHTML = `<p class="diary-search-empty">該当する作業ログはありません。</p>`;
    return;
  }

  box.innerHTML = `<ul class="diary-search-list">${result.hits.map(renderSearchResult).join("")}</ul>`;
}

function renderSearchLoading(keyword, anchorDate, searchDays) {
  const summary = document.getElementById("diarySearchSummary");
  const box = document.getElementById("diarySearchResults");
  if (!summary || !box) return;

  summary.style.display = "block";
  summary.textContent = `「${keyword}」を検索中… 起点 ${anchorDate} から前${searchDays}日`;

  box.style.display = "block";
  box.innerHTML = `<p class="diary-search-empty">検索しています…</p>`;
}

function renderLoadMoreControl(state) {
  const area = document.getElementById("diarySearchMoreArea");
  if (!area) return;

  if (!state?.keyword || !state?.hasMoreDiaryRange) {
    area.style.display = "none";
    area.innerHTML = "";
    return;
  }

  area.style.display = "block";
  area.innerHTML = `
    <button id="diarySearchMoreBtn" type="button" class="secondary-btn">さらに90日検索しますか？</button>
  `;
}

function bindSearchEvents({ mode, dateInput }) {
  const input = document.getElementById("diarySearchInput");
  const searchBtn = document.getElementById("diarySearchBtn");
  const clearBtn = document.getElementById("diarySearchClearBtn");
  const resultsBox = document.getElementById("diarySearchResults");
  const moreArea = document.getElementById("diarySearchMoreArea");
  if (!input || !searchBtn || !clearBtn || !resultsBox || !moreArea) return;

  if (input.dataset.boundSearchUi === "1") return;
  input.dataset.boundSearchUi = "1";

  let debounceTimer = null;
  let searchToken = 0;
  const DEBOUNCE_MS = 280;

  const performSearch = async () => {
    const token = ++searchToken;
    const keyword = input.value.trim();
    history.replaceState({}, "", buildDiaryUrl(mode, dateInput.value, keyword));

    if (!keyword) {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      activeSearchState = null;
      renderSearchState("", { total: 0, hits: [] });
      renderLoadMoreControl(null);
      return;
    }

    renderSearchLoading(keyword, dateInput.value, DIARY_BLOCK_DAYS);
    const result = await searchAllSources(keyword, dateInput.value, DIARY_BLOCK_DAYS);
    if (token !== searchToken) return;

    activeSearchState = {
      keyword,
      anchorDate: dateInput.value,
      searchedDays: DIARY_BLOCK_DAYS,
      logTotal: result.logTotal,
      logHits: result.hits.filter(v => v.source !== "diary"),
      diaryTotal: result.diaryTotal,
      diaryHits: result.hits.filter(v => v.source === "diary"),
      hasMoreDiaryRange: result.hasMoreDiaryRange
    };
    renderSearchState(keyword, result);
    renderLoadMoreControl(activeSearchState);
  };

  const scheduleDebouncedSearch = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      void performSearch();
    }, DEBOUNCE_MS);
  };

  searchBtn.addEventListener("click", () => {
    void performSearch();
  });

  clearBtn.addEventListener("click", () => {
    input.value = "";
    activeSearchState = null;
    history.replaceState({}, "", buildDiaryUrl(mode, dateInput.value, ""));
    renderSearchState("", { total: 0, hits: [] });
    renderLoadMoreControl(null);
  });

  input.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      void performSearch();
    }
  });

  input.addEventListener("input", () => {
    scheduleDebouncedSearch();
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

  if (!moreArea.dataset.boundSearchMore) {
    moreArea.dataset.boundSearchMore = "1";
    moreArea.addEventListener("click", async e => {
      const btn = e.target.closest("#diarySearchMoreBtn");
      if (!btn) return;
      if (!activeSearchState?.keyword || !activeSearchState?.hasMoreDiaryRange) return;

      const ok = confirm("さらに90日分を追加で検索しますか？");
      if (!ok) return;

      const nextDays = activeSearchState.searchedDays + DIARY_BLOCK_DAYS;
      renderSearchLoading(activeSearchState.keyword, activeSearchState.anchorDate, nextDays);

      const nextDiary = await searchDiaryJsonByKeywordRange(
        activeSearchState.keyword,
        activeSearchState.anchorDate,
        activeSearchState.searchedDays,
        DIARY_BLOCK_DAYS
      );

      activeSearchState.searchedDays = nextDays;
      activeSearchState.diaryTotal += nextDiary.total;
      activeSearchState.diaryHits = mergeByDateAndSource(activeSearchState.diaryHits, nextDiary.hits);
      activeSearchState.hasMoreDiaryRange = await canLoadMoreDiaryRange(
        activeSearchState.anchorDate,
        activeSearchState.searchedDays
      );

      const mergedHits = [...activeSearchState.logHits, ...activeSearchState.diaryHits]
        .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
        .slice(0, SEARCH_LIMIT);

      renderSearchState(activeSearchState.keyword, {
        total: activeSearchState.logTotal + activeSearchState.diaryTotal,
        logTotal: activeSearchState.logTotal,
        diaryTotal: activeSearchState.diaryTotal,
        hits: mergedHits,
        anchorDate: activeSearchState.anchorDate,
        searchDays: activeSearchState.searchedDays,
        rangeStart: buildRangeStartDate(activeSearchState.anchorDate, activeSearchState.searchedDays),
        rangeEnd: activeSearchState.anchorDate,
        hasMoreDiaryRange: activeSearchState.hasMoreDiaryRange
      });
      renderLoadMoreControl(activeSearchState);
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
  const today = getTodayJstDateString();
  const initialDate = urlDate || today;

  const dateInput = document.getElementById("diaryDate");
  const prevDayBtn = document.getElementById("prevDayBtn");
  const todayBtn = document.getElementById("todayBtn");
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

  if (todayBtn) {
    todayBtn.addEventListener("click", () => {
      const today = getTodayJstDateString();
      dateInput.value = today;
      dateInput.dispatchEvent(new Event("change"));
    });
  }

  // モード切り替えボタン描画（★ initialDate を反映）
  renderModeSwitch(mode, urlQuery);
  const searchInput = document.getElementById("diarySearchInput");
  if (searchInput) searchInput.value = urlQuery;
  bindSearchEvents({ mode, dateInput });
  await refreshDiaryMonthMini(initialDate);

  // 天気カード表示
  await renderWeatherBox(initialDate);

  // 作業ログ一覧表示
  const initialLogs = await loadLogsByDate(initialDate);
  await showWorkSummary(initialDate, initialLogs);

  renderLoadMoreControl(null);
  initCollapse("diarySearchTitle", "diarySearchPanel");

  // ▼ 折りたたみ（作業ログ一覧）
  initCollapse("workListTitle", "workList");

  // モード別カード表示
  if (mode === "edit") {
    isEditPageLoading = true;
    await initEditPage({ date: initialDate, logs: initialLogs });
    isEditPageLoading = false;
  } else {
    await initViewPageWithOptions({ date: initialDate, logs: initialLogs });
  }

  // ---------------------------------------------------------
  // 保存イベント（編集モードのみ）
  // ---------------------------------------------------------
  const saveBtn = document.getElementById("saveDiaryBtn");

  if (mode === "edit") {
    saveBtn.style.display = "block";
    saveBtn.disabled = false;

    saveBtn.addEventListener("click", async () => {
      if (isEditPageLoading) {
        alert("作業カードを読み込み中です。少し待ってから保存してください。");
        return;
      }
      if (isDiarySaving) return;

      const date = dateInput.value;
      if (!date) {
        alert("日付を選択してください。");
        return;
      }

      isDiarySaving = true;
      saveBtn.disabled = true;
      const originalText = saveBtn.textContent;
      saveBtn.textContent = "保存中…";

      try {
        await saveDiary(date, window.__currentDiaryWorkGroups || []);
      } finally {
        isDiarySaving = false;
        saveBtn.disabled = false;
        saveBtn.textContent = originalText;
      }
    });

  } else {
    saveBtn.style.display = "none";
  }

  // ---------------------------------------------------------
  // 日付変更イベント
  // ---------------------------------------------------------
  dateInput.addEventListener("change", async e => {
    const d = e.target.value;
    await refreshDiaryMonthMini(d);

    // 天気カード更新
    await renderWeatherBox(d);

    // 作業ログ一覧更新
    const logsByDate = await loadLogsByDate(d);
    await showWorkSummary(d, logsByDate);

    // ▼ 折りたたみ再適用
    initCollapse("workListTitle", "workList");

    // モード別カード更新
    if (mode === "edit") {
      isEditPageLoading = true;
      saveBtn.disabled = true;
      await initEditPage({ date: d, logs: logsByDate });
      isEditPageLoading = false;
      saveBtn.disabled = false;
    } else {
      await initViewPageWithOptions({ date: d, logs: logsByDate });
    }

    // ★ モード切り替えボタンも更新（新しい日付を反映）
    const currentSearch = document.getElementById("diarySearchInput")?.value?.trim() || "";
    renderModeSwitch(mode, currentSearch);
    activeSearchState = null;
    renderSearchState("", { total: 0, hits: [] });
    renderLoadMoreControl(null);
    history.replaceState({}, "", buildDiaryUrl(mode, d, currentSearch));
  });
  // (印刷時の一時処理は削除されました)
});
