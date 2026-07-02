// =========================================================
// diary/saveDiary.js
// 作業日誌の保存処理（既存JSON読み込み → 更新 → saveJSON）
// =========================================================

import { loadJSON, saveJSON } from "/common/json.js";

export async function saveDiary(date, autoList) {

  const year = date.slice(0, 4);

  // CloudFront 用（読み込み）
  const loadPath = `/diary/data/${year}/${date}.json`;

  // S3 用（保存）
  const savePath = `diary/data/${year}/${date}.json`;

  // -------------------------------
  // 既存 JSON を読み込む（なければ新規作成）
  // -------------------------------
  let current;
  try {
    current = await loadJSON(loadPath);
  } catch {
    current = { date, work: [], memo: "" };
  }

  // -------------------------------
  // 新しい作業データを作成
  // -------------------------------
  const newWork = autoList.map((item, idx) => ({
    type: item.type,
    workers: item.workers,
    start: document.getElementById(`start_${idx}`).value,
    end: document.getElementById(`end_${idx}`).value
  }));

  const freeMemo = document.getElementById("freeMemo").value;

  // -------------------------------
  // JSON を更新
  // -------------------------------
  current.work = newWork;
  current.memo = freeMemo;

  // -------------------------------
  // 保存（フォルダも自動作成）
  // -------------------------------
  try {
    await saveJSON(savePath, current);
    alert("保存しました");
  } catch (e) {
    console.error(e);
    alert("保存に失敗しました");
  }
}
