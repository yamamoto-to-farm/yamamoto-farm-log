// =========================================================
// diary/diary.js — 編集ページの初期化（保存イベントはここに集約）
// =========================================================

import { verifyLocalAuth } from "/common/ui.js";
import { renderHeader } from "/common/header.js";
import { showWorkSummary } from "./work-summary.js";
import { initEditPage } from "./editCard.js";
import { saveDiary } from "./saveDiary.js";
import { loadLogsByDate, extractWorkForEdit } from "./work-summary.js";
import { renderWeatherBox } from "./weather-box.js";

window.addEventListener("DOMContentLoaded", async () => {

  // 認証
  const ok = await verifyLocalAuth();
  if (!ok) return;

  // ヘッダー描画
  renderHeader();

  // ページ表示
  document.getElementById("form-area").style.display = "block";

  // 今日の日付をセット
  const today = new Date().toISOString().slice(0, 10);
  const dateInput = document.getElementById("diaryDate");
  dateInput.value = today;

  // 天気カード表示
  await renderWeatherBox(today);

  // 自動ログ一覧表示
  showWorkSummary(today);

  // 編集カード表示
  await initEditPage();

  // -------------------------------
  // 保存イベント（ここに1回だけ登録）
  // -------------------------------
  document.getElementById("saveDiaryBtn").addEventListener("click", async () => {
    const date = dateInput.value;

    // 最新ログを取得（initEditPage の autoList は古くなる可能性があるため）
    const logs = await loadLogsByDate(date);
    const autoList = extractWorkForEdit(logs);

    saveDiary(date, autoList);
  });

  // -------------------------------
  // 日付変更イベント
  // -------------------------------
  dateInput.addEventListener("change", async e => {
    const d = e.target.value;

    // 天気カード更新
    await renderWeatherBox(d);

    // 作業ログ一覧更新
    showWorkSummary(d);

    // 編集カード更新
    await initEditPage();
  });
});
