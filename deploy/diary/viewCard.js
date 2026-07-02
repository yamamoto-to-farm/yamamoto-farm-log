// =========================================================
// diary/viewCard.js — 閲覧専用カード
// =========================================================

import { loadDiaryByDate } from "./loadDiary.js";

/**
 * 閲覧専用カードを描画する
 */
export async function initViewPage() {

  const date = document.getElementById("diaryDate").value;
  const area = document.getElementById("editWorkArea");
  area.innerHTML = "読み込み中…";

  const diary = await loadDiaryByDate(date);

  if (!diary) {
    area.innerHTML = `
      <div class="edit-card">
        <p>この日の作業日誌はありません。</p>
      </div>
    `;
    return;
  }

  // 作業カード（閲覧専用）
  let html = "";

  diary.work.forEach(w => {
    html += `
      <div class="edit-card">
        <h3>${w.type}</h3>
        <p><strong>従事者：</strong> ${w.workers.join(" / ")}</p>
        <p><strong>開始：</strong> ${w.start}　<strong>終了：</strong> ${w.end}</p>
      </div>
    `;
  });

  // メモ（閲覧専用）
  html += `
    <div class="edit-card diary-memo">
      <h3>日誌メモ</h3>
      <p>${diary.memo ? diary.memo : "（メモなし）"}</p>
    </div>
  `;

  area.innerHTML = html;
}
