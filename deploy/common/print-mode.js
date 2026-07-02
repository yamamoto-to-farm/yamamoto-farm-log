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
        // ヘルパ: 指定セレクタの中身が実際に描画されるまでポーリング
        const waitForContent = async (sel, timeout = 5000, interval = 100) => {
          const start = Date.now();
          while (Date.now() - start < timeout) {
            const el = document.querySelector(sel);
            if (el) {
              const text = (el.innerText || '').trim();
              const imgs = el.querySelectorAll('img');
              const imgAllLoaded = imgs.length === 0 || Array.from(imgs).every(i => i.complete);
              // テキストがある、または画像が全て読み込み済み、または leaflet 要素を含む場合は準備完了と見なす
              if (text.length > 20 || imgAllLoaded || el.querySelector('.leaflet-container')) return true;
            }
            await new Promise(r => setTimeout(r, interval));
          }
          return false;
        };

        // マップページなら in-place print を使う（cloneだとタイルが複製されないため）
        const isMap = !!document.querySelector('.leaflet-container');
        if (isMap) {
          // タイル読み込みを待つ（最大5秒）
          const tilesReady = await (async () => {
            const start = Date.now();
            while (Date.now() - start < 5000) {
              if (document.querySelectorAll('.leaflet-tile-loaded').length > 0) return true;
              await new Promise(r => setTimeout(r, 200));
            }
            return false;
          })();

          try { if (window.map && typeof window.map.invalidateSize === 'function') window.map.invalidateSize(); } catch (e) {}
          // 少し余裕を持たせる
          await new Promise(r => setTimeout(r, tilesReady ? 300 : 800));
          try { window.print(); } catch (e) { console.warn('print-mode: fallback print failed', e); }
          return;
        }

        // 通常ページ: コンテンツ準備を待ってから printInline
        const ready = await waitForContent(selector, 5000, 100);
        if (!ready) console.warn('print-mode: content may not be fully ready before printing');
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
