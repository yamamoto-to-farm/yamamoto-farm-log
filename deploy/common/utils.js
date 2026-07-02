// utils.js
import { loadJSON } from "/common/json.js";


// URL から machine を取得（なければ machine1）
export function getMachineParam() {
  const url = new URL(location.href);
  return url.searchParams.get("machine") || "machine1";
}

export function formatDate(date) {
  if (!date) return "";
  const d = new Date(date);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/* ---------------------------------------------------------
   safeFileName（フィールド名・ロット名共通の正規化）
--------------------------------------------------------- */
export function safeFileName(name) {
  const before = name;

  const after = String(name)
    .normalize("NFKC")                 // 全角→半角
    .replace(/[()（）]/g, "")          // 括弧削除
    .replace(/・/g, "_")               // 中黒は区切り
    .replace(/[^\p{L}\p{N}_-]/gu, "_") // 日本語・英数字・_・- 以外は _
    .replace(/_+/g, "_")               // _ の連続を1つに
    .replace(/^_+|_+$/g, "");          // 先頭・末尾の _ 削除

  //console.log("[safeFileName] before =", before, "after =", after);
  return after;
}

/* ---------------------------------------------------------
   safeFieldName（safeFileName と完全統一）
--------------------------------------------------------- */
export function safeFieldName(field) {
  return safeFileName(field);
}

/* ---------------------------------------------------------
   cb（キャッシュバスター）
--------------------------------------------------------- */
export function cb(url) {
  const v = Date.now();
  const out = url.includes("?") ? `${url}&v=${v}` : `${url}?v=${v}`;
  console.log("[cb] in =", url, "out =", out);
  return out;
}

/* ---------------------------------------------------------
   作業完了ボタン（作業ページ専用）
--------------------------------------------------------- */
import { completeAndCloseModal } from "./save-modal.js";

export function attachWorkDoneButton() {
  const formArea = document.getElementById("form-area");
  if (!formArea) return; // 分析ページなど form-area がないページはスキップ

  const btn = document.createElement("button");
  btn.textContent = "作業完了";
  btn.className = "primary-btn";

  btn.addEventListener("click", () => {
    completeAndCloseModal("作業が完了しました。ページを閉じます。");
  });

  formArea.appendChild(btn);
}

/* ---------------------------------------------------------
   fileName → field を逆引きする関数
   （summary-index.json を利用）
--------------------------------------------------------- */
export async function resolveFieldFromFileName(fileName) {
  // 1. fileName から圃場名を抽出
  //    形式：YYYYMMDD-圃場名-品種.json
  const parts = fileName.replace(".json", "").split("-");
  if (parts.length < 3) return null;

  const rawField = parts[1]; // 生の圃場名（括弧・中黒あり）

  // 2. safeFileName() で正規化
  const normalizedField = safeFileName(rawField);

  // 3. summary-index.json を読み込む
  let sIndex = {};
  try {
    sIndex = await loadJSON("/data/summary-index.json");
  } catch (e) {
    console.error("[resolveField] summary-index.json load failed", e);
    return null;
  }

  // 4. 正規化名と一致するキーを探す
  if (sIndex[normalizedField]) {
    return normalizedField; // 正しい field 名
  }

  // 5. 見つからない場合
  console.warn("[resolveField] field not found:", normalizedField);
  return null;
}
/* ============================================================
   印刷ユーティリティ（全ページ共通）
============================================================ */
export async function printInline(selector, title = "印刷") {
  const target = document.querySelector(selector);
  if (!target) return;

  // 親側で折りたたみ解除（念のため）
  document.querySelectorAll(".field-group > div").forEach(w => {
    w.style.display = "block";
  });

  // iframe を作り非表示で設置（ゼロサイズだとレイアウトが崩れるので幅を確保）
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.left = "-2000px"; // 画面外に置く
  iframe.style.top = "0";
  iframe.style.width = "1000px"; // レイアウト用の幅
  iframe.style.height = "1400px"; // 印刷プレビューを想定した高さ
  iframe.style.border = "0";
  iframe.style.visibility = 'hidden';
  document.body.appendChild(iframe);

  const win = iframe.contentWindow;
  const doc = win.document;

  // ベースHTML
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><div id="print-root"></div></body></html>`);
  doc.close();

  // 親ドキュメントの <link rel="stylesheet"> を複製する
  const head = doc.head;
  const links = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
  const linkPromises = links.map(l => {
    return new Promise(resolve => {
      try {
        const newLink = doc.createElement('link');
        newLink.rel = 'stylesheet';
        newLink.href = l.href;
        newLink.onload = () => resolve();
        newLink.onerror = () => resolve();
        head.appendChild(newLink);
      } catch (e) { resolve(); }
    });
  });

  // 親の <style> 要素（インラインスタイル）もコピー
  document.querySelectorAll('style').forEach(s => {
    try { head.appendChild(doc.createElement('style')).textContent = s.textContent; } catch (e) {}
  });

  // タイトルヘッダを追加
  const titleEl = doc.createElement('h1');
  titleEl.style.fontSize = '20px';
  titleEl.style.marginBottom = '12px';
  titleEl.style.borderBottom = '2px solid #333';
  titleEl.textContent = title;
  doc.getElementById('print-root').appendChild(titleEl);

  // 対象ノードを深くコピーして iframe に挿入
  const clone = target.cloneNode(true);
  // 内部の折りたたみ系を強制展開
  clone.querySelectorAll && clone.querySelectorAll('.collapse-content, .field-group > div, #workList').forEach(el => {
    el.style.display = 'block';
    el.style.visibility = 'visible';
    el.style.overflow = 'visible';
    el.style.maxHeight = 'none';
  });

  doc.getElementById('print-root').appendChild(clone);

  // ヘッダーやフッター等をスタイルで非表示にする
  const hideCss = `@page{size:A4;margin:12mm;} @media print { .app-header, .app-footer, header, footer, .topbar, .modal, .overlay { display:none !important; } }`;
  const s = doc.createElement('style'); s.id = 'print-inline-overrides'; s.appendChild(doc.createTextNode(hideCss));
  head.appendChild(s);

  // スタイル読み込み完了と画像読み込みを待つ
  try {
    await Promise.race([
      Promise.all(linkPromises),
      new Promise(r => setTimeout(r, 3000)) // 最大待ち時間
    ]);

    // iframe 内の画像があればロード完了を待つ
    const imgs = Array.from(doc.images || []);
    await Promise.race([
      Promise.all(imgs.map(img => new Promise(resolve => {
        if (img.complete) return resolve();
        img.onload = img.onerror = () => resolve();
      }))),
      new Promise(r => setTimeout(r, 3000))
    ]);

    // WebFonts のロードを待つ（対応ブラウザ）
    try { if (doc.fonts && doc.fonts.ready) await doc.fonts.ready; } catch (e) {}

    // 強制的にリフローさせる（レンダリング安定化）
    try { void doc.body.offsetHeight; } catch (e) {}

    // 少し余裕を持たせる
    await new Promise(r => setTimeout(r, 150));

  } catch (e) {
    console.warn('printInline: waiting resources failed', e);
  }

  // 印刷イベントの後処理（iframe 削除）
  const cleanup = () => {
    try { if (iframe && iframe.parentNode) iframe.parentNode.removeChild(iframe); } catch (e) {}
  };

  // ブラウザ側で afterprint を捕まえて cleanup
  try {
    win.addEventListener('afterprint', cleanup);
  } catch (e) {}

  // フォールバック: print 後に削除
  const fallbackTimeout = setTimeout(() => { cleanup(); }, 10000);

  try {
    win.focus();
    win.print();
  } catch (e) {
    console.warn('printInline: print failed', e);
    cleanup();
  } finally {
    clearTimeout(fallbackTimeout);
  }
}

export async function printCurrentPage(title = document.title || "印刷") {
  const selector = document.querySelector("main")
    ? "main"
    : (document.querySelector("#content") ? "#content" : "body");

  const isMapPage = !!document.querySelector(".leaflet-container");
  if (isMapPage) {
    const waitForMapTiles = async (timeout = 5000, interval = 200) => {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const loadedTiles = document.querySelectorAll(".leaflet-tile-loaded").length;
        if (loadedTiles > 0) return true;
        await new Promise(resolve => setTimeout(resolve, interval));
      }
      return false;
    };

    try {
      if (window.map && typeof window.map.invalidateSize === "function") {
        window.map.invalidateSize();
      }
    } catch (e) {
      console.warn("printCurrentPage: map invalidateSize failed", e);
    }

    await waitForMapTiles();
    await new Promise(resolve => setTimeout(resolve, 300));
    window.print();
    return;
  }

  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  await printInline(selector, title);
}



