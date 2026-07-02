// print-mode.js
// シンプルな印刷専用モード。URLに ?print=1 がある場合に有効化される。
(function(){
  try {
    const params = new URLSearchParams(location.search);
    if (!params.has('print')) return;

    // 既に index にリダイレクトされている等は無視
    // 最低限のレイアウト調整
    document.documentElement.classList.add('print-mode');

    // hide common header/footer and overlays
    const hideSelectors = [
      '.app-header', '.app-footer', '.header', '.topbar', '.site-header',
      '.modal-bg', '.modal', '.overlay', '.filter-modal'
    ];
    hideSelectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        el.style.display = 'none';
        el.style.visibility = 'hidden';
      });
    });

    // 展開系を強制表示
    document.querySelectorAll('.collapse-content, #workList, .card, .edit-card, .view-card, .diary-container').forEach(el => {
      el.style.display = 'block';
      el.style.visibility = 'visible';
      el.style.overflow = 'visible';
      el.style.maxHeight = 'none';
    });

    // 必要なら追加の print 用スタイルを注入
    const css = `@page { size: A4; margin: 12mm; }\n@media print { body{ -webkit-print-color-adjust:exact; } .print-mode-hide{display:none !important;} }`;
    const s = document.createElement('style'); s.id = 'print-mode-style'; s.appendChild(document.createTextNode(css));
    document.head.appendChild(s);

    // wait for layout & images
    setTimeout(() => {
      try {
        window.print();
      } catch (e) {
        console.warn('print-mode: print() failed', e);
      }
    }, 300);

  } catch (e) {
    console.error('print-mode init error', e);
  }
})();
