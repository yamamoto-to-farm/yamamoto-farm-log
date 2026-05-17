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
eexport function printInline(selector, title = "印刷") {
  const target = document.querySelector(selector);
  if (!target) {
    alert("印刷対象が見つかりません");
    return;
  }

  // iframe 作成
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow.document;

  // ★ 最小構成の HTML（CSS も一切なし）
  doc.open();
  doc.write(`
    <html>
    <body>
      <h1>${title}</h1>
      <div>${target.innerHTML}</div>
    </body>
    </html>
  `);
  doc.close();

  iframe.onload = () => {
    iframe.contentWindow.print();
    document.body.removeChild(iframe);
  };
}


