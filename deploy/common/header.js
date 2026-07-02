// ===============================
// 共通ヘッダー + ロール別制御
// ===============================

import { printCurrentPage } from "/common/utils.js";
import { logoutAndRedirect } from "/common/ui.js";

export function renderHeader(options = {}) {
  const role = window.currentRole;
  const human = window.currentHuman;

  // ▼ ヘッダーHTML（共通）
  const headerHTML = `
    <header class="app-header">
      <h1 class="app-title">山本農園 OS</h1>
      <div class="header-right">
        <span id="login-user"></span>
        <button id="header-print-btn" class="print-btn" title="印刷">印刷</button>
        <button id="logout-btn" class="logout-btn" style="display:none;">ログアウト</button>
      </div>
    </header>
  `;
  document.body.insertAdjacentHTML("afterbegin", headerHTML);

  // 印刷ボタンのイベント（現在ページの描画済み DOM をそのまま印刷）
  const pb = document.getElementById('header-print-btn');
  if (pb) {
    pb.addEventListener('click', async () => {
      pb.disabled = true;
      try {
        const pageTitle = document.querySelector('.page-title, #field-name, h1');
        await printCurrentPage(pageTitle?.textContent?.trim() || document.title || '印刷');
      } catch (e) {
        console.error('header print failed', e);
        window.print();
      } finally {
        pb.disabled = false;
      }
    });
  }

  // ▼ ログイン情報は全ロールで表示
  document.getElementById("login-user").textContent =
    `ログイン中：${human}（${role}）`;

  // ▼ ロール別処理
  if (role === "worker") {
    // ===============================
    // worker：ナビバーなし・ログアウトあり
    // ===============================
    const logoutBtn = document.getElementById("logout-btn");
    logoutBtn.style.display = "inline-block";
    logoutBtn.addEventListener("click", () => {
      void logoutAndRedirect("logout");
    });

    // ※ 作業完了ボタンは utils.js 側で attachWorkDoneButton() を呼ぶ
    //   → header.js では一切扱わない

  } else if (role === "family") {
    // ===============================
    // family：公開ナビバーを表示
    // ===============================
    renderNavbar();

    // ▼ ログアウト可能
    const logoutBtn = document.getElementById("logout-btn");
    logoutBtn.style.display = "inline-block";
    logoutBtn.addEventListener("click", () => {
      void logoutAndRedirect("logout");
    });

  } else if (role === "admin") {
    // ===============================
    // admin：管理ページなら「戻る」リンク
    // ===============================
    if (options.adminPage) {
      renderBackToTop();
    } else {
      renderNavbar();
    }

    // ▼ ログアウト可能
    const logoutBtn = document.getElementById("logout-btn");
    logoutBtn.style.display = "inline-block";
    logoutBtn.addEventListener("click", () => {
      void logoutAndRedirect("logout");
    });
  }
}



// ===============================
// 公開側ナビバー（family / admin）
// ===============================

export function renderNavbar() {
  const html = `
    <nav style="
      padding: 10px 0;
      margin-bottom: 20px;
      border-bottom: 1px solid #ccc;
      font-size: 1.05em;
    ">
      <a href="/" style="margin-right: 15px;">🏠 トップ</a>
      <a href="/diary/index.html" style="margin-right: 15px;">📘 作業日誌</a>
      <a href="/list/list.html" style="margin-right: 15px;">🌱 播種・定植一覧</a>
      <a href="/performance/harvest-kpi.html" style="margin-right: 15px;">📊 収穫KPI</a>
      <a href="/fields/index.html" style="margin-right: 15px;">🗺 圃場</a>
      <a href="/varieties/index.html" style="margin-right: 15px;">🧬 品種</a>
    </nav>
  `;
  document.body.insertAdjacentHTML("afterbegin", html);
}



// ===============================
// 管理ページ専用「トップへ戻る」リンク
// ===============================

export function renderBackToTop() {
  const html = `
    <div style="margin-bottom: 20px;">
      <a href="/">← トップへ戻る</a>
    </div>
  `;
  document.body.insertAdjacentHTML("afterbegin", html);
}
