// =========================================================
// diary/diary.js — 閲覧／編集モード切り替え対応（権限は window.currentRole）
// =========================================================

import { verifyLocalAuth } from "/common/ui.js";
import { renderHeader } from "/common/header.js";
import { showWorkSummary, loadLogsByDate, extractWorkForEdit } from "./work-summary.js";
import { initEditPage } from "./editCard.js";
import { initViewPage } from "./viewCard.js";
import { saveDiary } from "./saveDiary.js";
import { renderWeatherBox } from "./weather-box.js";

// ---------------------------------------------------------
// モード切り替えボタン描画
// ---------------------------------------------------------
function renderModeSwitch(mode) {
  const area = document.getElementById("modeSwitchArea");
  if (!area) return;

  let html = `
    <button class="mode-btn ${mode === "view" ? "active" : ""}"
            onclick="location.href='index.html?mode=view'">
      閲覧モード
    </button>
  `;

  // ★ 権限判定は window.currentRole
  if (window.currentRole === "admin") {
    html += `
      <button class="mode-btn ${mode === "edit" ? "active" : ""}"
              onclick="location.href='index.html?mode=edit'">
        編集モード
      </button>
    `;
  }

  area.innerHTML = html;
}

// ---------------------------------------------------------
// メイン処理
// ---------------------------------------------------------
window.addEventListener("DOMContentLoaded", async () => {

  // 認証（true/false）
  const ok = await verifyLocalAuth();
  if (!ok) return;

  // モード判定
  const params = new URLSearchParams(location.search);
  const mode = params.get("mode") || "view";

  // ★ admin 以外は編集モード禁止
  if (mode === "edit" && window.currentRole !== "admin") {
    location.href = "index.html?mode=view";
    return;
  }

  // ヘッダー描画
  renderHeader();

  // モード切り替えボタン描画
  renderModeSwitch(mode);

  // ページ表示
  document.getElementById("form-area").style.display = "block";

  // 今日の日付をセット
  const today = new Date().toISOString().slice(0, 10);
  const dateInput = document.getElementById("diaryDate");
  dateInput.value = today;

  // 天気カード表示
  await renderWeatherBox(today);

  // 作業ログ一覧表示
  showWorkSummary(today);

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

      // 最新ログを取得
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
    showWorkSummary(d);

    // モード別カード更新
    if (mode === "edit") {
      await initEditPage();
    } else {
      await initViewPage();
    }
  });
});
