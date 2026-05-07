// seedList-render.js

import { getRows, makeEmptyRow } from "./seedList-state.js";
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

export function renderTable() {
  const rows = getRows();
  const tableArea = document.getElementById("table-area");

  let html = `
    <table class="schedule-table">
      <thead>
        <tr>
          <th>播種予定日</th>
          <th>品種</th>
          <th>枚数</th>
          <th>トレイ</th>
          <th>計画面積(反)</th>
          <th>計算面積(反)</th>
          <th>定植まで日数</th>
          <th>定植予定日</th>
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

  html += `
    <div style="margin-top: 16px;">
      <button id="saveCsvBtn" class="primary-btn">CSV に追加してクリア</button>
    </div>
  `;

  tableArea.innerHTML = html;

  attachEvents();
}

function attachEvents() {
  const rows = getRows();

  document.querySelectorAll("tr[data-index]").forEach(tr => {
    const idx = Number(tr.dataset.index);
    const row = rows[idx];

    const calcAreaCell = tr.querySelector(".calc-area-cell");
    const harvestCell = tr.querySelector(".harvest-cell");

    /* ▼ 播種予定日（再描画必要） */
    tr.querySelector(".input-sow").addEventListener("change", e => {
      row.planSowDate = e.target.value;

      if (row.planPlantDate) {
        const d1 = new Date(row.planSowDate);
        const d2 = new Date(row.planPlantDate);
        row.daysToPlant = Math.round((d2 - d1) / 86400000);
        row.daysToPlantRaw = row.daysToPlant;
      }

      row.harvestPlanYM = resolveHarvestYM(row.planPlantDate, row.planSowDate, row.harvestMonth);
      renderTable();
    });

    /* ▼ 品種（モーダル → 再描画） */
    tr.querySelector(".variety-cell").addEventListener("click", () => {
      openVarietySelectModal(selected => {
        row.variety = selected.name;
        renderTable();
      });
    });

    /* ▼ 枚数（再描画しない） */
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
    });

    /* ▼ トレイ（モーダル → 再描画） */
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

    /* ▼ 計算面積セルクリック → spacing モーダル */
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
      });
    });

    /* ▼ 日数（再描画しない） */
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
    });

    /* ▼ 定植予定日（再描画しない） */
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
}
