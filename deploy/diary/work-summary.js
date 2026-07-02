// =========================================================
// diary/work-summary.js — list.json + headerName 対応版（field 抽出対応）
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
// 作業編集カード用：作業名＋従事者＋圃場IDの自動抽出
// =========================================================

export function extractWorkForEdit(logs) {
  const autoList = [];

  logs.forEach(log => {
    const type = log.displayName; // 定植・収穫・播種など

    // worker 系列を抽出（worker1, worker2... / worker 単一列の両対応）
    const workers = [];
    Object.keys(log.data).forEach(key => {
      if (key.startsWith("worker") && log.data[key]) {
        workers.push(log.data[key]);
      }
    });

    if (workers.length === 0 && log.data.worker) {
      String(log.data.worker)
        .split(/[\/／]/)
        .map(v => v.trim())
        .filter(Boolean)
        .forEach(v => workers.push(v));
    }

    if (workers.length === 0) return;

    // ★ field 抽出（headerName に field がある場合のみ）
    let field = "";
    if (log.headerName.includes("field")) {
      const rawField = String(log.data["field"] ?? "").trim();
      // 「圃場A／圃場B」形式の場合は先頭を代表値として編集カードへ反映
      field = rawField ? rawField.split(/[\/／]/)[0].trim() : "";
    }

    autoList.push({
      type,
      workers,
      field   // ★ 圃場IDを追加
    });
  });

  return autoList;
}
