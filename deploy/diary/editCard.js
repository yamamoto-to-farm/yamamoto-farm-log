// =========================================================
// diary/editCard.js
// 作業編集カードの生成（既存日誌を反映）
// =========================================================

import { loadLogsByDate, extractWorkForEdit } from "./work-summary.js";
import { loadDiaryByDate } from "./loadDiary.js";

// ---------------------------------------------------------
// 編集カードを描画
// ---------------------------------------------------------
export function renderEditCards(autoList, diary) {
  const area = document.getElementById("editWorkArea");
  area.innerHTML = "";

  // -------------------------------
  // 自動抽出された作業カード
  // -------------------------------
  autoList.forEach((item, idx) => {

    // ★ 既存日誌に同じ作業があれば上書き
    const existing = diary?.work?.[idx] || {};

    const start = existing.start || "";
    const end = existing.end || "";

    // ★ 圃場名（既存日誌にあれば上書き）
    const field = existing.field || item.field || "";
    const fieldText = normalizeMultiText(field) || "（未入力）";
    const workersText = normalizeMultiText(existing.workers || item.workers) || "（未入力）";

    const card = document.createElement("div");
    card.className = "card edit-card";

    card.innerHTML = `
      <h3 class="edit-title">${item.type}</h3>
      <p class="edit-workers">圃場： ${fieldText}</p>
      <p class="edit-workers">従事者： ${workersText}</p>

      <input type="hidden" id="field_${idx}" value="${field}">

      <div class="time-row">
        <label>開始</label>
        <input type="time" id="start_${idx}" class="form-input" value="${start}">

        <label>終了</label>
        <input type="time" id="end_${idx}" class="form-input" value="${end}">
      </div>
    `;

    area.appendChild(card);
  });

  // -------------------------------
  // 日誌メモ（既存メモを反映）
  // -------------------------------
  const memoCard = document.createElement("div");
  memoCard.className = "card edit-card diary-memo";

  const memo = diary?.memo || "";

  memoCard.innerHTML = `
    <h3 class="edit-title">日誌メモ</h3>
    <p class="memo-desc">
      この日の作業ログがない場合や、未実装の作業がある場合はここに記入できます。
    </p>

    <textarea id="freeMemo" class="form-textarea">${memo}</textarea>
  `;

  area.appendChild(memoCard);
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

// ---------------------------------------------------------
// 初期化（保存イベントは diary.js に集約）
// ---------------------------------------------------------
export async function initEditPage() {
  const dateInput = document.getElementById("diaryDate");
  const date = dateInput.value;

  // ★ 既存の日誌を読み込む
  const diary = await loadDiaryByDate(date);   // null の可能性あり

  // ★ 作業ログから自動抽出（type, workers, field）
  const logs = await loadLogsByDate(date);
  const autoList = extractWorkForEdit(logs);

  // ★ 既存日誌を反映して描画
  renderEditCards(autoList, diary);
}
