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

export function safeFieldName(field) {
  return field
    .replace(/[()（）]/g, "_")  // 括弧を _
    .replace(/_+$/g, "");       // ★ 末尾の _ を削除（これが決定打）
}

export function safeFileName(name) {
  return name
    .replace(/[()（）]/g, "_")      // 括弧を _
    .replace(/[^\w\u3040-\u30FF\u4E00-\u9FFF-]/g, "_") // 日本語・英数字・ハイフン以外を _
    .replace(/_+/g, "_")            // 連続した _ を1つに
    .replace(/^_+|_+$/g, "");       // 先頭・末尾の _ を削除
}


export function cb(url) {
  const v = Date.now();
  return url.includes("?") ? `${url}&v=${v}` : `${url}?v=${v}`;
}