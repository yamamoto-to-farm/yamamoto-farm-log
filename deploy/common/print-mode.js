import { printInline } from '/common/utils.js';

// print-mode.js
// URL に ?print=1 がある場合、`printInline` を使って安定して印刷する。
(function(){
  try {
    const params = new URLSearchParams(location.search);
    if (!params.has('print')) return;

    // afterprint で新しいタブを閉じる（もし opener があるなら）
    window.addEventListener('afterprint', () => {
      try { if (window.opener) window.close(); } catch (e) {}
    });

    // 印刷対象セレクタの推定（main > #content > body）
    const selector = document.querySelector('main') ? 'main' : (document.querySelector('#content') ? '#content' : 'body');

    // 折りたたみ解除・簡易隠しUI を即時適用してから printInline を呼ぶ
    document.documentElement.classList.add('print-mode');
    ['.app-header', '.app-footer', '.header', '.topbar', '.modal-bg', '.modal', '.overlay', '.filter-modal'].forEach(sel => {
      document.querySelectorAll(sel).forEach(el => { el.style.display = 'none'; el.style.visibility = 'hidden'; });
    });
    document.querySelectorAll('.collapse-content, #workList, .card, .diary-container').forEach(el => {
      el.style.display = 'block'; el.style.visibility = 'visible'; el.style.overflow = 'visible'; el.style.maxHeight = 'none';
    });

    // 少し待ってから printInline を呼ぶ（DOM/Leaflet 初期化を待つ）
    setTimeout(async () => {
      try {
        await printInline(selector, document.title || '印刷');
      } catch (e) {
        console.error('print-mode: printInline failed', e);
        try { window.print(); } catch (e2) { console.warn('fallback print failed', e2); }
      }
    }, 300);

  } catch (e) {
    console.error('print-mode init error', e);
  }
})();
