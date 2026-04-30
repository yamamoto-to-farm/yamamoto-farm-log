// admin/edit-csv/loader.js

// ★ キャッシュは使わない（常に最新を取得）
window._csvCache = {};

/**
 * CSV を読み込む
 * @param {string} csvType - planting / harvest / seed / seedList など
 * @param {string} csvFile - all.csv など
 */
export async function loadCSV(csvType, csvFile) {
  try {
    let url;

    // ==========================================================
    // ★ seedList.csv だけ特別パス
    // ==========================================================
    if (csvType === "seedList") {
      url = `/schedule/seedList.csv`;
    } else {
      // 通常の CSV は CloudFront 経由
      url = `https://d3sscxnlo0qnhe.cloudfront.net/logs/${csvType}/${csvFile}`;
    }

    // ★ 毎回キャッシュ破棄（編集画面は常に最新を読む）
    delete window._csvCache[url];

    // ★ CloudFront キャッシュ回避（?ts=）
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

    // ★ 必要ならキャッシュ（ただし毎回破棄される）
    window._csvCache[url] = data;

    return data;

  } catch (e) {
    console.error("[admin] CSV 読み込み失敗:", e);
    return [];
  }
}
