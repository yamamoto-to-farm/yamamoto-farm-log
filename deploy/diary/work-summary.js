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

// =========================================================
// diary/work-summary.js — フォルダ一覧をまず表示する版
// =========================================================

// ローカルの /logs/ を叩く（CloudFront は使わない）
export async function listLogFolders() {
  const res = await fetch(`/logs/?ts=${Date.now()}`);
  const html = await res.text();

  const div = document.createElement("div");
  div.innerHTML = html;

  // <a href="planting/"> のようなリンクを抽出
  return [...div.querySelectorAll("a")]
    .map(a => a.getAttribute("href"))
    .filter(href => href.endsWith("/"))
    .map(href => href.replace("/", ""));
}

// UI にフォルダ一覧を表示する
export async function showFolderList() {
  const box = document.getElementById("workList");
  const folders = await listLogFolders();

  if (folders.length === 0) {
    box.innerHTML = "<p>logs フォルダが見つかりません。</p>";
    return;
  }

  box.innerHTML = `
    <h3>フォルダ一覧</h3>
    <ul>
      ${folders.map(f => `<li>${f}</li>`).join("")}
    </ul>
  `;
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
