// seedList-capacity.js

import { getRows } from "./seedList-state.js";

/* ===============================
   育苗ハウス容量チェック（最大同時在庫方式）
=============================== */
export function checkCapacity() {
  const rows = getRows();
  const capacityInput = document.getElementById("nurseryCapacity");
  if (!capacityInput) return;

  const capacity = Number(capacityInput.value) || 0;

  let events = [];

  rows.forEach(r => {
    if (r.trayCount > 0 && r.planSowDate) {
      // ★ 冷暗2日後にハウス入り
      const start = new Date(r.planSowDate);
      start.setDate(start.getDate() + 2);
      const startDate = start.toISOString().slice(0, 10);

      events.push({ date: startDate, delta: r.trayCount });
    }

    if (r.trayCount > 0 && r.planPlantDate) {
      events.push({ date: r.planPlantDate, delta: -r.trayCount });
    }
  });

  // 日付順に並べる
  events.sort((a, b) => a.date.localeCompare(b.date));

  let stock = 0;
  let maxStock = 0;
  const timeline = [];

  for (const ev of events) {
    stock += ev.delta;
    if (stock > maxStock) maxStock = stock;
    timeline.push({ date: ev.date, stock });
  }

  /* ===============================
     行ごとの over-capacity 判定
  ================================ */
  document.querySelectorAll("tr[data-index]").forEach(tr => {
    const idx = Number(tr.dataset.index);
    const r = rows[idx];
    const cell = tr.querySelector(".calc-area-cell");

    cell.classList.remove("over-capacity");

    if (!r.planSowDate || !r.planPlantDate || r.trayCount <= 0) return;

    // ★ 行ごとの冷暗2日後
    const sowStart = new Date(r.planSowDate);
    sowStart.setDate(sowStart.getDate() + 2);
    const sowStartStr = sowStart.toISOString().slice(0, 10);

    const over = timeline.some(t =>
      t.date >= sowStartStr &&
      t.date < r.planPlantDate &&
      t.stock > capacity
    );

    if (over) {
      cell.classList.add("over-capacity");
    }
  });

  // ★ summary 表示を checkCapacity の結果で更新
  updateSummary(maxStock);
}


/* ===============================
   summary 表示（最大同時在庫方式に統一）
=============================== */
export function updateSummary(maxStock = 0) {
  const rows = getRows();
  const capacity = Number(document.getElementById("nurseryCapacity").value) || 0;

  // 面積は従来通り合計
  const totalArea = rows.reduce((sum, r) => sum + (Number(r.planAreaCalc) || 0), 0);

  const diff = capacity - maxStock;

  let statusHtml = "";

  if (diff >= 0) {
    statusHtml = `<span style="color:green; font-weight:bold;">OK（残り ${diff} 枚）</span>`;
  } else {
    statusHtml = `<span style="color:red; font-weight:bold;">⚠ 容量オーバー（不足 ${Math.abs(diff)} 枚）</span>`;
  }

  document.getElementById("summaryArea").innerHTML = `
    <div>最大同時トレイ数：${maxStock} 枚</div>
    <div>総予定面積：${totalArea.toFixed(2)} 反</div>
    <div>育苗ハウス容量：${capacity} 枚</div>
    <div style="margin-top:6px;">${statusHtml}</div>
  `;
}
