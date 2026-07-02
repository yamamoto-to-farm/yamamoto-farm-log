// =========================================================
// diary/editCard.js
// 作業編集カードの生成と保存
// =========================================================

import { loadLogsByDate, extractWorkForEdit } from "./work-summary.js";

// 編集カードを描画
export function renderEditCards(autoList) {
  const area = document.getElementById("editWorkArea");
  area.innerHTML = "";

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
}

// 保存処理
export async function saveDiary(date, autoList) {
  const saveData = {
    date,
    work: []
  };

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

  const year = date.slice(0, 4);
  const path = `/diary/data/${year}/${date}.json`;

  const res = await fetch(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(saveData, null, 2)
  });

  if (!res.ok) {
    alert("保存に失敗しました");
    return;
  }

  alert("保存しました");
}

// 初期化
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
