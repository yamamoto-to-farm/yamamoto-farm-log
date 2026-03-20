// グローバルキャッシュ
window._csvCache = window._csvCache || {};

export async function loadCSV(url) {
  try {
    // ★ 1. ローカルキャッシュがあれば即返す（GitHub 遅延を無視）
    if (window._csvCache[url]) {
      return window._csvCache[url];
    }

    // ★ 2. なければ fetch（初回のみ）
    const res = await fetch(url + "?ts=" + Date.now());
    const text = await res.text();

    if (!text.trim()) return [];

    const lines = text.trim().split("\n");
    const headers = lines[0].split(",");

    const data = lines.slice(1).map(line => {
      const cols = line.split(",");
      const obj = {};
      headers.forEach((h, i) => obj[h] = cols[i] || "");
      return obj;
    });

    // ★ 3. 読み込んだ内容をキャッシュ
    window._csvCache[url] = data;

    return data;

  } catch (e) {
    console.error("[admin] CSV 読み込み失敗:", e);
    return [];
  }
}