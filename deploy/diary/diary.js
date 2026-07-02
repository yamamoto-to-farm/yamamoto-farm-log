// =========================================================
// diary/diary.js — 統合ハブ（初期化・イベント登録・他JS呼び出し）
// =========================================================

import { verifyLocalAuth } from "/common/ui.js";
import { renderHeader } from "/common/header.js";

import { showWeatherBox } from "./weather-box.js";
import { showWorkSummary } from "./work-summary.js";
import { saveDiary } from "./save.js";

window.addEventListener("DOMContentLoaded", async () => {

  // -----------------------------
  // 認証
  // -----------------------------
  const ok = await verifyLocalAuth();
  if (!ok) return;

  // -----------------------------
  // ヘッダー描画
  // -----------------------------
  renderHeader();

  // -----------------------------
  // ページ表示
  // -----------------------------
  document.getElementById("form-area").style.display = "block";

  // -----------------------------
  // 今日の日付をセット
  // -----------------------------
  const today = new Date().toISOString().slice(0, 10);
  const dateInput = document.getElementById("diaryDate");
  dateInput.value = today;

  // -----------------------------
  // 初期表示（気象＋作業一覧）
  // -----------------------------
  showWeatherBox(today);
  showWorkSummary(today);

  // -----------------------------
  // 日付変更イベント
  // -----------------------------
  dateInput.addEventListener("change", e => {
    const d = e.target.value;
    showWeatherBox(d);
    showWorkSummary(d);
  });

  // -----------------------------
  // 保存ボタン
  // -----------------------------
  document.getElementById("saveDiaryBtn")
    ?.addEventListener("click", saveDiary);
});
