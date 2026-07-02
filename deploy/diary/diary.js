// =========================================================
// diary/diary.js — 編集ページの初期化
// =========================================================

import { verifyLocalAuth } from "/common/ui.js";
import { renderHeader } from "/common/header.js";
import { showWorkSummary } from "./work-summary.js";
import { initEditPage } from "./editCard.js";

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

  // 自動ログ一覧表示
  showWorkSummary(today);

  // 編集カード表示
  initEditPage();

  // 日付変更イベント
  dateInput.addEventListener("change", async e => {
    const d = e.target.value;

    showWorkSummary(d);
    initEditPage();
  });
});
