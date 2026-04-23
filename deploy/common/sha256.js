// common/sha256.js
// Web Crypto API を使った軽量 SHA-256 ハッシュ関数
// year-index.json の更新判定などに使用

export async function sha256(message) {
  // 文字列 → Uint8Array
  const encoder = new TextEncoder();
  const data = encoder.encode(message);

  // SHA-256 計算
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);

  // バイト列 → 16進文字列
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");

  return hashHex;
}
