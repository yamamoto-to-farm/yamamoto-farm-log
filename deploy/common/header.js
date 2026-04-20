// ===============================
// 公開側ナビバー（family までアクセス可能）
// ===============================
// ※ 表示対象：トップ / KPI / 圃場分析 / 圃場別分析 / 月別KPI / 地図（任意）
// ※ 非表示対象：作業ログ（seed / planting / harvest / shipping）
// ※ 非表示対象：管理ページ（admin 専用）
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
// ※ 表示対象：admin 専用ページ（CSV編集・QR生成・summary管理など）
// ※ ナビバーは絶対に出さない
// ===============================

export function renderBackToTop() {
  const html = `
    <div style="margin-bottom: 20px;">
      <a href="/">← トップへ戻る</a>
    </div>
  `;
  document.body.insertAdjacentHTML("afterbegin", html);
}