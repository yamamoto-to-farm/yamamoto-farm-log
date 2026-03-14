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
   safeFieldName（デバッグログ付き）
--------------------------------------------------------- */
export function safeFieldName(field) {
  const before = field;
  const after = field
    .replace(/[()（）]/g, "_")
    .replace(/_+$/g, "");

  console.log("[safeFieldName] before =", before, "after =", after);
  return after;
}

/* ---------------------------------------------------------
   safeFileName（デバッグログ付き）
--------------------------------------------------------- */
export function safeFileName(name) {
  const before = name;
  const after = name
    .replace(/[()（）]/g, "_")
    .replace(/[^\w\u3040-\u30FF\u4E00-\u9FFF-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  console.log("[safeFileName] before =", before, "after =", after);
  return after;
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