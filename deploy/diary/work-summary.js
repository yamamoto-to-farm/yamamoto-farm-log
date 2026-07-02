// =========================================================
// diary/work-summary.js — list.json + headerName 対応版
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
    return null; // ← 存在しないフォルダは読み飛ばす
  }
}

// 日付一致のログを集約
export async function loadLogsByDate(date) {
  const folderList = await loadFolderList();
  const result = [];

  for (const item of folderList) {
    const { folder, dateColumn, displayName, headerName } = item;

    const rows = await loadLogCsv(folder);
    if (!rows) continue; // all.csv が無いフォルダは除外

    rows
      .filter(r => r[dateColumn] === date)
      .forEach(r => {
        result.push({
          folder,
          displayName,
          headerName,
          data: r
        });
      });
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

  box.innerHTML = logs.map(log => {
    const cols = log.headerName.map(col => log.data[col] ?? "");
    return `
      <div class="work-item">
        <p><strong>${log.displayName}</strong></p>
        <p>${cols.join(" / ")}</p>
      </div>
    `;
  }).join("");
}
// =========================================================
// 作業編集カード用：作業名＋従事者の自動抽出
// =========================================================

export function extractWorkForEdit(logs) {
  const autoList = [];

  logs.forEach(log => {
    const type = log.displayName; // 定植・収穫・播種など

    // worker 系列を抽出
    const workers = [];
    Object.keys(log.data).forEach(key => {
      if (key.startsWith("worker") && log.data[key]) {
        workers.push(log.data[key]);
      }
    });

    if (workers.length === 0) return;

    autoList.push({
      type,
      workers
    });
  });

  return autoList;
}
