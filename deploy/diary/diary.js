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

  // ---------------------------------------------------------
  // 印刷時の表示調整（モーダルやオーバーレイを取り除く）
  // ---------------------------------------------------------
  const beforePrint = () => {
    // 一時的に readonly-mode を外して非表示ルールを解除
    if (document.body.classList.contains("readonly-mode")) {
      document.body._hadReadonly = true;
      document.body.classList.remove("readonly-mode");
    }

    // 非表示のオーバーレイがあれば隠す
    const modalBg = document.querySelectorAll('.modal-bg');
    modalBg.forEach(el => el.style.display = 'none');
    const modals = document.querySelectorAll('.modal');
    modals.forEach(el => el.style.display = 'none');

    // ensure form-area visible
    const fa = document.getElementById('form-area');
    if (fa) fa.style.display = 'block';
  };

  const afterPrint = () => {
    // restore readonly-mode if it was present
    if (document.body._hadReadonly) {
      document.body.classList.add('readonly-mode');
      delete document.body._hadReadonly;
    }

    // remove forced styles on modals (they'll be restored by app logic)
    const modalBg = document.querySelectorAll('.modal-bg');
    modalBg.forEach(el => el.style.display = '');
    const modals = document.querySelectorAll('.modal');
    modals.forEach(el => el.style.display = '');
  };

  if (window.matchMedia) {
    window.matchMedia('print').addListener(mql => {
      if (mql.matches) beforePrint(); else afterPrint();
    });
  }
  window.addEventListener('beforeprint', beforePrint);
  window.addEventListener('afterprint', afterPrint);
});
