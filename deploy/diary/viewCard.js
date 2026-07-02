// =========================================================
// diary/viewCard.js — 閲覧専用カード（時系列ソート＋圃場名対応）
// =========================================================

import { loadDiaryByDate } from "./loadDiary.js";

/**
 * 圃場名を取得する
 */
async function loadFieldDetail() {
  try {
    const res = await fetch("/data/field-detail.json");
    if (!res.ok) return [];
    return await res.json();
  } catch (e) {
    console.warn("field-detail.json が読み込めませんでした");
    return [];
  }
}

function getFieldName(fieldId, fieldDetail) {
  if (!fieldId) return "";
  const f = fieldDetail.find(x => x.id === fieldId);
  return f ? f.name : "";
}

/**
 * 閲覧専用カードを描画する
 */
export async function initViewPage() {

  const date = document.getElementById("diaryDate").value;
  const area = document.getElementById("editWorkArea");
  area.innerHTML = "読み込み中…";

  const diary = await loadDiaryByDate(date);
  const fieldDetail = await loadFieldDetail();

  if (!diary) {
    area.innerHTML = `
      <div class="view-card">
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

    const fieldName = getFieldName(w.field || "", fieldDetail);
    const title = fieldName ? `${w.type} ${fieldName}` : w.type;

    html += `
      <div class="view-card">
        <h3>${title}</h3>
        <p><strong>従事者：</strong> ${w.workers.join(" / ")}</p>
        <p><strong>開始：</strong> ${w.start}　<strong>終了：</strong> ${w.end}</p>
      </div>
    `;
  });

  // ---------------------------------------------
  // メモ（閲覧専用）
  // ---------------------------------------------
  html += `
    <div class="view-card diary-memo">
      <h3>日誌メモ</h3>
      <p>${diary.memo ? diary.memo : "（メモなし）"}</p>
    </div>
  `;

  area.innerHTML = html;
}
