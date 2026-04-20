// ===============================
// 共通ヘッダー + ロール別制御
// ===============================

export function renderHeader(options = {}) {
  const role = window.currentRole;
  const human = window.currentHuman;

  // ▼ ヘッダーHTML（共通）
  const headerHTML = `
    <header class="app-header">
      <h1 class="app-title">山本農園 OS</h1>
      <div class="header-right">
        <span id="login-user"></span>
        <button id="logout-btn" class="logout-btn" style="display:none;">ログアウト</button>
      </div>
    </header>
  `;
  document.body.insertAdjacentHTML("afterbegin", headerHTML);

  // ▼ ログイン情報は全ロールで表示
  document.getElementById("login-user").textContent =
    `ログイン中：${human}（${role}）`;

  // ▼ ロール別処理
  if (role === "worker") {
    // ===============================
    // worker：ナビバーなし・ログアウトなし
    // ===============================
    // ナビバーは絶対に出さない（何もしない）
    document.getElementById("logout-btn").style.display = "none";

    // ▼ 作業完了ボタンを自動追加
    const formArea = document.getElementById("form-area");
    if (formArea) {
      const doneBtn = document.createElement("button");
      doneBtn.textContent = "作業完了";
      doneBtn.className = "primary-btn";
      doneBtn.style.marginTop = "20px";

      doneBtn.addEventListener("click", () => {
        window.close();
      });

      formArea.appendChild(doneBtn);
    }

  } else if (role === "family") {
    // ===============================
    // family：公開ナビバーを表示
    // ===============================
    renderNavbar();

    // ▼ ログアウト可能
    const logoutBtn = document.getElementById("logout-btn");
    logoutBtn.style.display = "inline-block";
    logoutBtn.addEventListener("click", () => {
      localStorage.removeItem("human");
      localStorage.removeItem("role");
      location.href = "/index.html";
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
      localStorage.removeItem("human");
      localStorage.removeItem("role");
      location.href = "/index.html";
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
      <a href="/performance/harvest-kpi.html" style="margin-right: 15px;">📊 収穫KPI</a>
      <a href="/analysis/index.html">🗺 圃場詳細</a>
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
