// =========================================================
// diary/viewCard.js — 閲覧専用カード（時系列ソート＋圃場名対応）
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
      <div class="card view-card">
        <p>この日の作業日誌はありません。</p>
      </div>
    `;
    return;
  }

  // ---------------------------------------------
  // 時系列ソート（閲覧モードのみ）
  // ---------------------------------------------
  const workList = [...diary.work]; // 破壊しないようコピー

  workList.sort((a, b) => {
    const t1 = a.start || "99:99";
    const t2 = b.start || "99:99";
    return t1.localeCompare(t2);
  });

  // ---------------------------------------------
  // 作業カード（折りたたみなし）
  // ---------------------------------------------
  let html = "";

  workList.forEach(w => {

    // 配列/文字列どちらでも表示できるように正規化
    const fieldName = normalizeMultiText(w.field);
    const title = w.type;
    const fieldLine = fieldName || "（未入力）";

    const workerText = normalizeMultiText(w.workers);
    const workerLine = workerText || "（未入力）";
    const machineLine = String(w.machine || "").trim() || "（未入力）";

    html += `
      <div class="card view-card">
        <h3>${title}</h3>
        <p><strong>圃場：</strong> ${fieldLine}</p>
        <p><strong>従事者：</strong> ${workerLine}　　<strong>作業機械：</strong> ${machineLine}</p>
        <p><strong>開始：</strong> ${w.start}　<strong>終了：</strong> ${w.end}</p>
      </div>
    `;
  });

  // ---------------------------------------------
  // メモ（閲覧専用）
  // ---------------------------------------------
  html += `
    <div class="card view-card diary-memo">
      <h3>日誌メモ</h3>
      <p>${diary.memo ? diary.memo : "（メモなし）"}</p>
    </div>
  `;

  area.innerHTML = html;
}

function normalizeMultiText(value) {
  if (Array.isArray(value)) {
    return value
      .map(v => String(v || "").trim())
      .filter(Boolean)
      .join("／");
  }

  return String(value || "").trim();
}
