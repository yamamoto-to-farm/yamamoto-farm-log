// =========================================================
// diary/work-summary.js — list.json + all.csv 存在チェック版（完成）
// =========================================================

import { loadCSV, normalizeKeys } from "/common/csv.js";

// list.json を読み込む
async function loadFolderList() {
  const res = await fetch("/diary/list.json");
  if (!res.ok) {
    console.error("list.json が読み込めませんでした");
    return [];
  }
  return await res.json();
}

// CSV 読み込み（404 は null を返す）
async function loadLogCsv(folder) {
  try {
    const rows = await loadCSV(`/logs/${folder}/all.csv`);
    return normalizeKeys(rows);
  } catch (e) {
    console.warn(`[work-summary] all.csv が見つかりません: ${folder}`);
    return null; // ← ここが重要（存在しないフォルダは除外）
  }
}

// 日付一致のログを集約
export async function loadLogsByDate(date) {
  const folderList = await loadFolderList();
  const result = [];

  for (const item of folderList) {
    const { folder, dateColumn, displayName } = item;

    const rows = await loadLogCsv(folder);
    if (!rows) continue; // ← all.csv が無いフォルダは読み飛ばす

    rows
      .filter(r => r[dateColumn] === date)
      .forEach(r => result.push({ folder, displayName, data: r }));
  }

  return result;
}

// UI 表示
export async function showWorkSummary(date) {
  const box = document.getElementById("workList");
  const logs = await loadLogsByDate(date);

  if (logs.length === 0) {
    box.innerHTML = "<p>この日の作業ログはありません。</p>";
    return;
  }

  box.innerHTML = logs.map(log => `
    <div class="work-item">
      <p><strong>${log.displayName}</strong></p>
      <p>${Object.values(log.data).join(" / ")}</p>
    </div>
  `).join("");
}
