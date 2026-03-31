// utils.js

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

  if (!name) {
    console.warn("[safeFileName] name is empty/undefined → 'unknown'");
    return "unknown";
  }

  const after = String(name)
    .normalize("NFKC")                 // 全角→半角
    .replace(/[()（）]/g, "")          // 括弧削除
    .replace(/・/g, "_")               // 中黒は区切り
    .replace(/[^\p{L}\p{N}_-]/gu, "_") // 日本語・英数字・_・- 以外は _
    .replace(/_+/g, "_")               // _ の連続を1つに
    .replace(/^_+|_+$/g, "");          // 先頭・末尾の _ 削除

  console.log("[safeFileName] before =", before, "after =", after);
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