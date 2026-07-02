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
        const waitForContent = async (sel, timeout = 10000, interval = 100) => {
          const start = Date.now();

          // 最低限 document load を待つ（速ければすぐ進む）
          if (document.readyState !== 'complete') {
            await new Promise(r => {
              const onLoad = () => { window.removeEventListener('load', onLoad); r(); };
              window.addEventListener('load', onLoad);
              setTimeout(() => { window.removeEventListener('load', onLoad); r(); }, 2000);
            });
          }

          return await new Promise(resolve => {
            let finished = false;
            const checkOnce = () => {
              if (finished) return;
              const el = document.querySelector(sel);
              if (el) {
                const text = (el.innerText || '').trim();
                const imgs = el.querySelectorAll('img');
                const imgAllLoaded = imgs.length === 0 || Array.from(imgs).every(i => i.complete);
                const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { height: 0 };
                // 条件: 十分なテキスト量、または画像がロード済みか、または要素高さがある、または leaflet を含む
                if (text.length > 20 || imgAllLoaded && el.children.length > 0 || rect.height > 40 || el.querySelector('.leaflet-container')) {
                  finished = true; return resolve(true);
                }
              }
              if (Date.now() - start >= timeout) {
                finished = true; return resolve(false);
              }
            };

            // MutationObserver で変化を監視
            const obs = new MutationObserver(() => { checkOnce(); });
            obs.observe(document.documentElement || document, { childList: true, subtree: true, attributes: true });

            // 定期チェック
            const id = setInterval(() => { checkOnce(); }, interval);

            // 初回チェック
            checkOnce();

            // 解除関数
            const cleanup = () => { clearInterval(id); try{ obs.disconnect(); }catch(e){} };

            // resolve 時にクリーンアップするラッパー
            const origResolve = resolve;
            resolve = (v) => { cleanup(); origResolve(v); };
          });
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
