// =========================================================
// diary/work-summary.js
// ---------------------------------------------------------
// 役割：
//   - logs/ フォルダ一覧を自動取得
//   - 各フォルダの all.csv を CloudFront 経由で読み込む
//   - 日付一致の行だけ抽出
//   - 作業日誌ページに一覧表示
//
//   ※ diary.js がこのファイルを呼び出す（統合ハブ）
// =========================================================

import { loadCSV, normalizeKeys } from "/common/csv.js";

// CloudFront のベース URL（common/csv.js と同じ）
const CF_BASE = "https://d3sscxnlo0qnhe.cloudfront.net";

// ---------------------------------------------------------
// logs/ フォルダ一覧を取得
// ---------------------------------------------------------
// CloudFront の /logs/ を fetch すると HTML が返るので、
// <a href="planting/"> のようなリンクを抽出してフォルダ名にする。
export async function listLogFolders() {
  const url = `${CF_BASE}/logs/?ts=${Date.now()}`;
  const res = await fetch(url);
  const html = await res.text();

  const div = document.createElement("div");
  div.innerHTML = html;

  return [...div.querySelectorAll("a")]
    .map(a => a.getAttribute("href"))
    .filter(href => href.endsWith("/"))   // フォルダだけ
    .map(href => href.replace("/", ""));  // "planting/" → "planting"
}

// ---------------------------------------------------------
// logs/〇〇/all.csv を読み込む
// ---------------------------------------------------------
async function loadLogCsv(folder) {
  const path = `/logs/${folder}/all.csv`;

  try {
    const rows = await loadCSV(path);  // ← CloudFront + S3 専用ローダー
    return normalizeKeys(rows);        // ← キー整形（任意）
  } catch (e) {
    console.warn(`[work-summary] CSV not found in ${folder}`);
    return null;
  }
}

// ---------------------------------------------------------
// 日付一致のログを集約
// ---------------------------------------------------------
export async function loadLogsByDate(date) {
  const folders = await listLogFolders();
  const result = [];

  for (const folder of folders) {
    const rows = await loadLogCsv(folder);
    if (!rows) continue;

    rows
      .filter(r => r.date === date)
      .forEach(r => result.push({ folder, data: r }));
  }

  return result;
}

// ---------------------------------------------------------
// UI 表示
// ---------------------------------------------------------
export async function showWorkSummary(date) {
  const box = document.getElementById("workList");
  const logs = await loadLogsByDate(date);

  if (logs.length === 0) {
    box.innerHTML = "<p>この日の作業ログはありません。</p>";
    return;
  }

  box.innerHTML = logs.map(log => `
    <div class="work-item">
      <p><strong>${log.folder}</strong></p>
      <p>${Object.values(log.data).join(" / ")}</p>
    </div>
  `).join("");
}
