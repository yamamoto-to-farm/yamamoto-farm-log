// =========================================================
// diary/editCard.js
// 作業編集カードの生成と保存（CloudFront + saveJSON API 対応）
// =========================================================

import { loadLogsByDate, extractWorkForEdit } from "./work-summary.js";
import { saveJSON } from "/common/json.js";

// ---------------------------------------------------------
// 編集カードを描画
// ---------------------------------------------------------
export function renderEditCards(autoList) {
  const area = document.getElementById("editWorkArea");
  area.innerHTML = "";

  // -------------------------------
  // 自動抽出された作業カード
  // -------------------------------
  autoList.forEach((item, idx) => {
    const card = document.createElement("div");
    card.className = "edit-card";

    card.innerHTML = `
      <h3>${item.type}</h3>
      <p>従事者: ${item.workers.join(", ")}</p>

      <label>開始時刻</label>
      <input type="time" id="start_${idx}" class="form-input">

      <label>終了時刻</label>
      <input type="time" id="end_${idx}" class="form-input">

      <label>メモ</label>
      <textarea id="memo_${idx}" rows="2" class="form-textarea"></textarea>
    `;

    area.appendChild(card);
  });

  // -------------------------------
  // フリーメモカード（作業ログがなくても必ず表示）
  // -------------------------------
  const memoCard = document.createElement("div");
  memoCard.className = "edit-card";

  memoCard.innerHTML = `
    <h3>その他メモ</h3>
    <p>この日の作業ログがない場合や、ログ未実装の作業がある場合はここに記入できます。</p>

    <label>メモ</label>
    <textarea id="freeMemo" rows="3" class="form-textarea"></textarea>
  `;

  area.appendChild(memoCard);
}

// ---------------------------------------------------------
// 保存処理（saveJSON API 使用）
// ---------------------------------------------------------
export async function saveDiary(date, autoList) {
  const saveData = {
    date,
    work: []
  };

  // -------------------------------
  // 自動抽出された作業の保存
  // -------------------------------
  autoList.forEach((item, idx) => {
    const start = document.getElementById(`start_${idx}`).value;
    const end = document.getElementById(`end_${idx}`).value;
    const memo = document.getElementById(`memo_${idx}`).value;

    saveData.work.push({
      type: item.type,
      workers: item.workers,
      start,
      end,
      memo
    });
  });

  // -------------------------------
  // フリーメモの保存
  // -------------------------------
  const freeMemo = document.getElementById("freeMemo").value;
  saveData.memo = freeMemo;

  // -------------------------------
  // 保存先パス
  // -------------------------------
  const year = date.slice(0, 4);
  const path = `/diary/data/${year}/${date}.json`;

  try {
    await saveJSON(path, saveData);
    alert("保存しました");
  } catch (e) {
    console.error(e);
    alert("保存に失敗しました");
  }
}

// ---------------------------------------------------------
// 初期化
// ---------------------------------------------------------
export async function initEditPage() {
  const dateInput = document.getElementById("diaryDate");
  const date = dateInput.value;

  const logs = await loadLogsByDate(date);
  const autoList = extractWorkForEdit(logs);

  renderEditCards(autoList);

  document.getElementById("saveDiaryBtn").addEventListener("click", () => {
    saveDiary(date, autoList);
  });
}
