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
import { initCollapse } from "/common/collapse.js";

// ---------------------------------------------------------
// モード切り替えボタン描画（★ 日付を URL に保持）
// ---------------------------------------------------------
function renderModeSwitch(mode) {
  const area = document.getElementById("modeSwitchArea");
  if (!area) return;

  const date = document.getElementById("diaryDate").value;

  let html = `
    <button class="mode-btn ${mode === "view" ? "active" : ""}"
            onclick="location.href='index.html?mode=view&date=${date}'">
      閲覧モード
    </button>
  `;

  if (window.currentRole === "admin") {
    html += `
      <button class="mode-btn ${mode === "edit" ? "active" : ""}"
              onclick="location.href='index.html?mode=edit&date=${date}'">
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

  // URL パラメータ
  const params = new URLSearchParams(location.search);
  const mode = params.get("mode") || "view";
  const urlDate = params.get("date");

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
  dateInput.value = initialDate;

  // モード切り替えボタン描画（★ initialDate を反映）
  renderModeSwitch(mode);

  // 天気カード表示
  await renderWeatherBox(initialDate);

  // 作業ログ一覧表示
  showWorkSummary(initialDate);

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

      // ★ 保存時は autoList を再生成（構造維持）
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

    // ▼ 折りたたみ再適用
    initCollapse("workListTitle", "workList");

    // モード別カード更新
    if (mode === "edit") {
      await initEditPage();
    } else {
      await initViewPage();
    }

    // ★ モード切り替えボタンも更新（新しい日付を反映）
    renderModeSwitch(mode);
  });
});
