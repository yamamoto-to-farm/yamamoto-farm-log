// =========================================================
// diary/editCard.js
// 作業編集カードの生成（保存は saveDiary.js に分離）
// =========================================================

import { loadLogsByDate, extractWorkForEdit } from "./work-summary.js";

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
      <h3 class="edit-title">${item.type}</h3>
      <p class="edit-workers">従事者: ${item.workers.join("／")}</p>

      <div class="time-row">
        <label>開始</label>
        <input type="time" id="start_${idx}" class="form-input">

        <label>終了</label>
        <input type="time" id="end_${idx}" class="form-input">
      </div>
    `;

    area.appendChild(card);
  });

  // -------------------------------
  // 日誌メモ（作業ログがなくても必ず表示）
  // -------------------------------
  const memoCard = document.createElement("div");
  memoCard.className = "edit-card diary-memo";

  memoCard.innerHTML = `
    <h3 class="edit-title">日誌メモ</h3>
    <p class="memo-desc">
      この日の作業ログがない場合や、未実装の作業がある場合はここに記入できます。
    </p>

    <textarea id="freeMemo" class="form-textarea"></textarea>
  `;

  area.appendChild(memoCard);
}

// ---------------------------------------------------------
// 初期化（保存イベントは diary.js に集約）
// ---------------------------------------------------------
export async function initEditPage() {
  const dateInput = document.getElementById("diaryDate");
  const date = dateInput.value;

  const logs = await loadLogsByDate(date);
  const autoList = extractWorkForEdit(logs);

  renderEditCards(autoList);

  // ★ 保存イベントはここでは登録しない
  //   → diary.js が saveDiary(date, autoList) を1回だけ登録する
}
