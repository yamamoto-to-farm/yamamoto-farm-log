// seedList-render.js

import { getRows, makeEmptyRow } from "./seedList-state.js";
import {
  calcAreaFromTray,
  calcPlanPlantDate,
  resolveHarvestYM
} from "./seedList-calc.js";
import {
  openVarietySelectModal,
  openTrayTypeSelectModal
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
        <td>${r.planAreaCalc || ""}</td>
        <td><input type="text" inputmode="numeric" class="input-days" value="${r.daysToPlantRaw}"></td>
        <td><input type="date" class="input-plant" value="${r.planPlantDate}"></td>
        <td>${r.harvestPlanYM || ""}</td>
        <td>第${r.harvestWeek}週</td>
        <td><input type="text" class="input-source" value="${r.source || ""}"></td>
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

    /* ▼ 播種予定日 */
    tr.querySelector(".input-sow").addEventListener("change", e => {
      row.planSowDate = e.target.value;

      // 定植日があれば日数再計算
      if (row.planPlantDate) {
        const d1 = new Date(row.planSowDate);
        const d2 = new Date(row.planPlantDate);
        row.daysToPlant = Math.round((d2 - d1) / 86400000);
        row.daysToPlantRaw = row.daysToPlant;
      }

      row.harvestPlanYM = resolveHarvestYM(row.planPlantDate, row.planSowDate, row.harvestMonth);
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

      row.planAreaCalc = calcAreaFromTray(row.trayCount, row.trayType);
      tr.querySelector("td:nth-child(6)").textContent = row.planAreaCalc || "";
    });

    /* ▼ トレイタイプ */
    tr.querySelector(".tray-type-cell").addEventListener("click", () => {
      openTrayTypeSelectModal(type => {
        row.trayType = type;
        row.planAreaCalc = calcAreaFromTray(row.trayCount, row.trayType);
        renderTable();
      });
    });

    /* ▼ 日数 */
    tr.querySelector(".input-days").addEventListener("input", e => {
      row.daysToPlantRaw = e.target.value;
      row.daysToPlant = Number(row.daysToPlantRaw) || 0;

      row.planPlantDate = calcPlanPlantDate(row.planSowDate, row.daysToPlant);
      row.harvestPlanYM = resolveHarvestYM(row.planPlantDate, row.planSowDate, row.harvestMonth);

      renderTable();
    });

    /* ▼ 定植予定日（手入力可能） */
    tr.querySelector(".input-plant").addEventListener("change", e => {
      row.planPlantDate = e.target.value;

      if (row.planSowDate) {
        const d1 = new Date(row.planSowDate);
        const d2 = new Date(row.planPlantDate);
        row.daysToPlant = Math.round((d2 - d1) / 86400000);
        row.daysToPlantRaw = row.daysToPlant;
      }

      row.harvestPlanYM = resolveHarvestYM(row.planPlantDate, row.planSowDate, row.harvestMonth);
      renderTable();
    });

    /* ▼ 備考 */
    tr.querySelector(".input-source").addEventListener("input", e => {
      row.source = e.target.value;
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
