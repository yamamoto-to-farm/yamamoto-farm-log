// schedule/seed/seedList-render.js

import { getRows, makeEmptyRow } from "./seedList-state.js";
import {
  calcAreaFromTray,
  calcPlanPlantDate,
  resolveHarvestYM,
  renderSummary
} from "./seedList-calc.js";
import {
  openVarietySelectModal,
  openTrayTypeSelectModal,
  openHarvestMonthModal
} from "./seedList-modal.js";

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
          <th>予定面積(反)</th>
          <th>定植まで日数</th>
          <th>定植予定日</th>
          <th>収穫予定</th>
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
        <td>${r.planArea || ""}</td>
        <td><input type="text" inputmode="numeric" class="input-days" value="${r.daysToPlantRaw}"></td>
        <td>${r.planPlantDate || ""}</td>
        <td class="harvest-cell">${r.harvestPlanYM || "選択"}</td>
      </tr>
    `;
  });

  html += `</tbody></table>`;
  tableArea.innerHTML = html;

  attachEvents();
  renderSummary();
}

function attachEvents() {
  const rows = getRows();

  document.querySelectorAll("tr[data-index]").forEach(tr => {
    const idx = Number(tr.dataset.index);
    const row = rows[idx];

    // 播種予定日
    tr.querySelector(".input-sow").addEventListener("change", e => {
      row.planSowDate = e.target.value;
      row.planPlantDate = calcPlanPlantDate(row.planSowDate, row.daysToPlant);
      renderTable();
    });

    // 品種
    tr.querySelector(".variety-cell").addEventListener("click", () => {
      openVarietySelectModal(selected => {
        row.variety = selected.name;
        row.cropType = selected.type;
        renderTable();
      });
    });

    // 枚数（再描画しない）
    tr.querySelector(".input-tray").addEventListener("input", e => {
      row.trayCountRaw = e.target.value;
      row.trayCount = Number(row.trayCountRaw) || 0;
      row.planArea = calcAreaFromTray(row.trayCount, row.trayType);

      tr.querySelector("td:nth-child(5)").textContent = row.planArea || "";
      renderSummary();
    });

    // トレイ
    tr.querySelector(".tray-type-cell").addEventListener("click", () => {
      openTrayTypeSelectModal(type => {
        row.trayType = type;
        row.planArea = calcAreaFromTray(row.trayCount, row.trayType);
        renderTable();
      });
    });

    // 日数（再描画しない）
    tr.querySelector(".input-days").addEventListener("input", e => {
      row.daysToPlantRaw = e.target.value;
      row.daysToPlant = Number(row.daysToPlantRaw) || 0;
      row.planPlantDate = calcPlanPlantDate(row.planSowDate, row.daysToPlant);

      tr.querySelector("td:nth-child(7)").textContent = row.planPlantDate || "";
      renderSummary();
    });

    // 収穫予定月
    tr.querySelector(".harvest-cell").addEventListener("click", () => {
      openHarvestMonthModal(mm => {
        row.harvestPlanYM = resolveHarvestYM(row.planPlantDate, row.planSowDate, mm);
        renderTable();
      });
    });
  });

  // 行追加
  document.getElementById("addRowBtn").onclick = () => {
    rows.push(makeEmptyRow());
    renderTable();
  };

  // 容量変更
  document.getElementById("nurseryCapacity").oninput = () => {
    renderSummary();
  };
}
