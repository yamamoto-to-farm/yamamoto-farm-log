// seedList-render.js

import { getRows, makeEmptyRow, sortKey, sortOrder, setSort } from "./seedList-state.js";
import {
  calcAreaFromTray,
  calcPlanPlantDate,
  resolveHarvestYM
} from "./seedList-calc.js";
import {
  openVarietySelectModal,
  openTrayTypeSelectModal,
  openSpacingModal
} from "./seedList-modal.js";
import { saveSeedList } from "./seedList-save.js";

/* ===============================
   ソート処理
=============================== */
function sortRows() {
  const rows = getRows();

  if (!sortKey) return rows;

  rows.sort((a, b) => {
    const va = a[sortKey] || "";
    const vb = b[sortKey] || "";

    // ▼ 日付ソート
    if (sortKey === "planSowDate" || sortKey === "planPlantDate") {
      return sortOrder === "asc"
        ? va.localeCompare(vb)
        : vb.localeCompare(va);
    }

    // ▼ 数値ソート
    return sortOrder === "asc"
      ? Number(va) - Number(vb)
      : Number(vb) - Number(va);
  });

  return rows;
}

/* ===============================
   テーブル描画
=============================== */
export function renderTable() {
  sortRows();  // ★ ソート適用

  const rows = getRows();
  const tableArea = document.getElementById("table-area");

  let html = `
    <table class="schedule-table">
      <thead>
        <tr>
          <th class="sortable" data-key="planSowDate">播種予定日</th>
          <th class="sortable" data-key="variety">品種</th>
          <th class="sortable" data-key="trayCount">枚数</th>
          <th>トレイ</th>
          <th>計画面積(反)</th>
          <th class="sortable" data-key="planAreaCalc">計算面積(反)</th>
          <th class="sortable" data-key="daysToPlant">定植まで日数</th>
          <th class="sortable" data-key="planPlantDate">定植予定日</th>
          <th>収穫予定</th>
          <th>収穫区分</th>
          <th>種の由来</th>
          <th>備考</th>
        </tr>
      </thead>
      <tbody>
  `;

  rows.forEach((r, i) => {
    html += `
      <tr data-index="${i}">
        <td><input type="date" class="input-sow" value="${r.planSowDate}"></td>
        <td class="variety-cell">${r.variety || "選択"}</td>
        <td><input type="text" inputmode="numeric" class="input-tray" value="${r.trayCountRaw}"></td>
        <td class="tray-type-cell">${r.trayType || "選択"}</td>

        <td>${r.planAreaPlan || ""}</td>
        <td class="calc-area-cell clickable">${r.planAreaCalc || ""}</td>

        <td><input type="text" inputmode="numeric" class="input-days" value="${r.daysToPlantRaw}"></td>
        <td><input type="date" class="input-plant" value="${r.planPlantDate}"></td>

        <td class="harvest-cell">${r.harvestPlanYM || ""}</td>
        <td>第${r.harvestWeek}週</td>

        <td><input type="text" class="input-source" value="${r.source || ""}"></td>
        <td><input type="text" class="input-memo" value="${r.memo || ""}"></td>
      </tr>
    `;
  });

  html += `</tbody></table>`;


  tableArea.innerHTML = html;

  attachEvents();
  checkCapacity();
  updateSummary();
}

/* ===============================
   イベント付与
=============================== */
function attachEvents() {
  const rows = getRows();

  /* ▼ ソートヘッダー */
  document.querySelectorAll("th.sortable").forEach(th => {
    th.addEventListener("click", () => {
      const key = th.dataset.key;
      setSort(key);
      renderTable();
    });
  });

  /* ▼ 行ごとのイベント */
  document.querySelectorAll("tr[data-index]").forEach(tr => {
    const idx = Number(tr.dataset.index);
    const row = rows[idx];

    const calcAreaCell = tr.querySelector(".calc-area-cell");
    const harvestCell = tr.querySelector(".harvest-cell");

    /* ▼ 播種予定日 */
    tr.querySelector(".input-sow").addEventListener("change", e => {
      row.planSowDate = e.target.value;

      if (row.planPlantDate) {
        const d1 = new Date(row.planSowDate);
        const d2 = new Date(row.planPlantDate);
        row.daysToPlant = Math.round((d2 - d1) / 86400000);
        row.daysToPlantRaw = row.daysToPlant;
      }

      row.harvestPlanYM = resolveHarvestYM(
        row.planPlantDate,
        row.planSowDate,
        row.harvestMonth
      );
      renderTable();
    });

    /* ▼ 品種 */
    tr.querySelector(".variety-cell").addEventListener("click", () => {
      openVarietySelectModal(selected => {
        row.variety = selected.name;
        renderTable();
      });
    });

    /* ▼ 枚数 */
    tr.querySelector(".input-tray").addEventListener("input", e => {
      row.trayCountRaw = e.target.value;
      row.trayCount = Number(row.trayCountRaw) || 0;

      row.planAreaCalc = calcAreaFromTray(
        row.trayCount,
        row.trayType,
        row.spacingRow,
        row.spacingBed
      );

      calcAreaCell.textContent = row.planAreaCalc || "";
      checkCapacity();
      updateSummary();
    });

    /* ▼ トレイ */
    tr.querySelector(".tray-type-cell").addEventListener("click", () => {
      openTrayTypeSelectModal(type => {
        row.trayType = type;
        row.planAreaCalc = calcAreaFromTray(
          row.trayCount,
          row.trayType,
          row.spacingRow,
          row.spacingBed
        );
        renderTable();
      });
    });

    /* ▼ spacing モーダル */
    calcAreaCell.addEventListener("click", () => {
      openSpacingModal(row, updated => {
        row.spacingRow = updated.spacingRow;
        row.spacingBed = updated.spacingBed;

        row.planAreaCalc = calcAreaFromTray(
          row.trayCount,
          row.trayType,
          row.spacingRow,
          row.spacingBed
        );

        calcAreaCell.textContent = row.planAreaCalc || "";
        checkCapacity();
        updateSummary();
      });
    });

    /* ▼ 日数 */
    tr.querySelector(".input-days").addEventListener("input", e => {
      row.daysToPlantRaw = e.target.value;
      row.daysToPlant = Number(row.daysToPlantRaw) || 0;

      row.planPlantDate = calcPlanPlantDate(row.planSowDate, row.daysToPlant);
      row.harvestPlanYM = resolveHarvestYM(
        row.planPlantDate,
        row.planSowDate,
        row.harvestMonth
      );

      tr.querySelector(".input-plant").value = row.planPlantDate || "";
      harvestCell.textContent = row.harvestPlanYM || "";
      checkCapacity();
      updateSummary();
    });

    /* ▼ 定植予定日 */
    tr.querySelector(".input-plant").addEventListener("change", e => {
      row.planPlantDate = e.target.value;

      if (row.planSowDate) {
        const d1 = new Date(row.planSowDate);
        const d2 = new Date(row.planPlantDate);
        row.daysToPlant = Math.round((d2 - d1) / 86400000);
        row.daysToPlantRaw = row.daysToPlant;
      }

      row.harvestPlanYM = resolveHarvestYM(
        row.planPlantDate,
        row.planSowDate,
        row.harvestMonth
      );

      tr.querySelector(".input-days").value = row.daysToPlantRaw || "";
      harvestCell.textContent = row.harvestPlanYM || "";
      checkCapacity();
      updateSummary();
    });

    /* ▼ 種の由来 */
    tr.querySelector(".input-source").addEventListener("input", e => {
      row.source = e.target.value;
    });

    /* ▼ 備考 */
    tr.querySelector(".input-memo").addEventListener("input", e => {
      row.memo = e.target.value;
    });
  });

  /* ▼ 行追加 */
  document.getElementById("addRowBtn").onclick = () => {
    rows.push(makeEmptyRow());
    renderTable();
  };

  /* ▼ CSV 保存 */
  const saveBtn = document.getElementById("saveCsvBtn");
  if (saveBtn) {
    saveBtn.onclick = () => {
      saveSeedList();
    };
  }

  /* ▼ 容量変更時に即反映 */
  const cap = document.getElementById("nurseryCapacity");
  if (cap) {
    cap.addEventListener("input", () => {
      checkCapacity();
      updateSummary();
    });
  }
}

/* ===============================
   育苗ハウス容量チェック
=============================== */
function checkCapacity() {
  const rows = getRows();
  const capacityInput = document.getElementById("nurseryCapacity");
  if (!capacityInput) return;

  const capacity = Number(capacityInput.value) || 0;

  let events = [];

  rows.forEach(r => {
    if (r.trayCount > 0 && r.planSowDate) {
      events.push({ date: r.planSowDate, delta: r.trayCount });
    }
    if (r.trayCount > 0 && r.planPlantDate) {
      events.push({ date: r.planPlantDate, delta: -r.trayCount });
    }
  });

  events.sort((a, b) => a.date.localeCompare(b.date));

  let stock = 0;
  const timeline = [];

  for (const ev of events) {
    stock += ev.delta;
    timeline.push({ date: ev.date, stock });
  }

  document.querySelectorAll("tr[data-index]").forEach(tr => {
    const idx = Number(tr.dataset.index);
    const r = rows[idx];
    const cell = tr.querySelector(".calc-area-cell");

    cell.classList.remove("over-capacity");

    if (!r.planSowDate || !r.planPlantDate || r.trayCount <= 0) return;

    const over = timeline.some(t =>
      t.date >= r.planSowDate &&
      t.date < r.planPlantDate &&
      t.stock > capacity
    );

    if (over) {
      cell.classList.add("over-capacity");
    }
  });
}

/* ===============================
   summary 表示
=============================== */
function updateSummary() {
  const rows = getRows();
  const capacity = Number(document.getElementById("nurseryCapacity").value) || 0;

  const totalTrays = rows.reduce((sum, r) => sum + (r.trayCount || 0), 0);
  const totalArea = rows.reduce((sum, r) => sum + (Number(r.planAreaCalc) || 0), 0);

  const remain = capacity - totalTrays;

  let statusHtml = "";

  if (remain >= 0) {
    statusHtml = `<span style="color:green; font-weight:bold;">OK（残り ${remain} 枚）</span>`;
  } else {
    statusHtml = `<span style="color:red; font-weight:bold;">⚠ 容量オーバー（不足 ${Math.abs(remain)} 枚）</span>`;
  }

  document.getElementById("summaryArea").innerHTML = `
    <div>総トレイ枚数：${totalTrays} 枚</div>
    <div>総予定面積：${totalArea.toFixed(2)} 反</div>
    <div>育苗ハウス容量：${capacity} 枚</div>
    <div style="margin-top:6px;">${statusHtml}</div>
  `;
}
