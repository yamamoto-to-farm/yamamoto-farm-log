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
import { checkCapacity } from "./seedList-capacity.js";

/* ===============================
   ソート処理
=============================== */
function sortRows() {
  const rows = getRows();

  if (!sortKey) return rows;

  rows.sort((a, b) => {
    const va = a[sortKey] || "";
    const vb = b[sortKey] || "";

    if (sortKey === "planSowDate" || sortKey === "planPlantDate") {
      return sortOrder === "asc"
        ? va.localeCompare(vb)
        : vb.localeCompare(va);
    }

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
  sortRows();

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
          <th class="print-hide-plan-area">計画面積(反)</th>
          <th class="sortable" data-key="planAreaCalc">計算面積(反)</th>
          <th class="sortable" data-key="daysToPlant">定植まで日数</th>
          <th class="sortable" data-key="planPlantDate">定植予定日</th>
          <th>収穫予定</th>
          <th>収穫区分</th>
          <th>種の由来</th>
          <th>備考</th>
          <th class="print-delete-col">削除</th>
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

        <td class="print-hide-plan-area">${r.planAreaPlan || ""}</td>
        <td class="calc-area-cell clickable">${r.planAreaCalc || ""}</td>

        <td><input type="text" inputmode="numeric" class="input-days" value="${r.daysToPlantRaw}"></td>
        <td><input type="date" class="input-plant" value="${r.planPlantDate}"></td>

        <td class="harvest-cell">${r.harvestPlanYM || ""}</td>
        <td>第${r.harvestWeek}週</td>

        <td><input type="text" class="input-source" value="${r.source || ""}"></td>
        <td><input type="text" class="input-memo" value="${r.memo || ""}"></td>

        <td class="print-delete-col"><button class="delete-row" data-i="${i}">削除</button></td>
      </tr>
    `;
  });

  html += `</tbody></table>`;
  tableArea.innerHTML = html;

  attachEvents();
  checkCapacity();   // ★ updateSummary は capacity.js 内で呼ばれる
}

/* ===============================
   イベント付与
=============================== */
function attachEvents() {
  const rows = getRows();

  /* ▼ ソート */
  document.querySelectorAll("th.sortable").forEach(th => {
    th.addEventListener("click", () => {
      const key = th.dataset.key;
      setSort(key);
      renderTable();
    });
  });

  /* ▼ 行イベント */
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

    /* ▼ spacing */
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
    });

    /* ▼ 種の由来 */
    tr.querySelector(".input-source").addEventListener("input", e => {
      row.source = e.target.value;
    });

    /* ▼ 備考 */
    tr.querySelector(".input-memo").addEventListener("input", e => {
      row.memo = e.target.value;
    });

    /* ▼ 行削除 */
    tr.querySelector(".delete-row").addEventListener("click", () => {
      rows.splice(idx, 1);
      renderTable();
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

  /* ▼ 容量変更 */
  const cap = document.getElementById("nurseryCapacity");
  if (cap) {
    cap.addEventListener("input", () => {
      checkCapacity();
    });
  }
}
