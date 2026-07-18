// =========================================================
// diary/saveDiary.js
// 保存先を data/diary/ に変更した版（field 対応）
// =========================================================

import { loadJSON, saveJSON } from "/common/json.js";
import {
  showSaveModal,
  completeSaveModal,
  closeSaveModal,
  confirmSaveBeforeSubmit
} from "/common/save-modal.js?v=1";

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
    sourceKey: String(item.sourceKey || ""),
    sessionKey: String(item.sessionKey || "").trim(),
    type: String(item.type || item.workType || "").trim(),
    workType: String(item.workType || item.type || "").trim(),
    sowingCategory: String(item.sowingCategory || "").trim(),
    // workers と同じく配列で保存（複数値は "／" でまとめる）
    field: normalizeMultiValueAsArray((String(item.folder || "").trim() === "seed") ? "" : (document.getElementById(`field_${idx}`)?.value || item.field || "")),
    workers: normalizeMultiValueAsArray(item.workers),
    machine: String(document.getElementById(`machine_${idx}`)?.value || item.machine || "").trim(),
    start: document.getElementById(`start_${idx}`)?.value || "",
    end: document.getElementById(`end_${idx}`)?.value || "",
    items: Array.isArray(item.items) ? item.items.map(subItem => ({
      sourceKey: String(subItem.sourceKey || ""),
      sessionKey: String(subItem.sessionKey || item.sessionKey || "").trim(),
      type: String(subItem.type || subItem.workType || item.type || item.workType || "").trim(),
      workType: String(subItem.workType || subItem.type || item.workType || item.type || "").trim(),
      sowingCategory: String(subItem.sowingCategory || item.sowingCategory || "").trim(),
      field: normalizeMultiValueAsArray((String(item.folder || "").trim() === "seed") ? "" : (subItem.field || "")),
      workers: normalizeMultiValueAsArray(subItem.workers || ""),
      machine: String(subItem.machine || item.machine || "").trim(),
      start: String(subItem.start || item.start || "").trim(),
      end: String(subItem.end || item.end || "").trim()
    })) : []
  }));

  const filteredWork = newWork.filter(entry => hasValidWorkType(entry));

  current.work = filteredWork;
  current.workType = Array.from(new Set(filteredWork.map(w => String(w.type || w.workType || "").trim()).filter(Boolean))).join("／");
  current.memo = document.getElementById("freeMemo").value;

  const confirmed = await confirmSaveBeforeSubmit({
    lines: [
      `日付: ${date}`,
      `作業件数: ${filteredWork.length}件`,
      `メモ: ${current.memo ? "あり" : "なし"}`
    ]
  });
  if (!confirmed) return;

  // -------------------------------
  // 保存（data/diary/ 配下なので確実に保存される）
  // -------------------------------
  try {
    showSaveModal("保存しています…");
    await saveJSON(savePath, current);
    completeSaveModal("保存が完了しました");
  } catch (e) {
    closeSaveModal();
    console.error(e);
    alert("保存に失敗しました");
  }
}

function normalizeMultiValueAsArray(value) {
  const raw = Array.isArray(value) ? value.join("／") : String(value || "");

  const parts = raw
    .split(/[\/／]/)
    .map(v => v.trim())
    .filter(Boolean);

  if (parts.length === 0) return [];

  // 既存互換のため「配列1要素（／区切り）」形式で保存する
  return [parts.join("／")];
}

function hasValidWorkType(entry) {
  const type = String(entry?.type || entry?.workType || "").trim();
  if (type) return true;

  // 明示的な type が無いものは保存対象にしない
  return false;
}
