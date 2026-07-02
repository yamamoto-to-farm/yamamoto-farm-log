// =========================================================
// diary/saveDiary.js
// 保存先を data/diary/ に変更した版（field 対応）
// =========================================================

import { loadJSON, saveJSON } from "/common/json.js";

export async function saveDiary(date, autoList) {

  const year = date.slice(0, 4);

  // CloudFront 用（読み込み）
  const loadPath = `/data/diary/${year}/${date}.json`;

  // S3 用（保存）
  const savePath = `data/diary/${year}/${date}.json`;

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
  // 新しい作業データを作成（field 対応）
  // -------------------------------
  const newWork = autoList.map((item, idx) => ({
    type: item.type,
    field: document.getElementById(`field_${idx}`).value || "",   // ★ 圃場IDを保存
    workers: item.workers,
    start: document.getElementById(`start_${idx}`).value,
    end: document.getElementById(`end_${idx}`).value
  }));

  current.work = newWork;
  current.memo = document.getElementById("freeMemo").value;

  // -------------------------------
  // 保存（data/diary/ 配下なので確実に保存される）
  // -------------------------------
  try {
    await saveJSON(savePath, current);
    alert("保存しました");
  } catch (e) {
    console.error(e);
    alert("保存に失敗しました");
  }
}
