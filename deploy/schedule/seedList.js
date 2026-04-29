// ===============================
// schedule/seedList.js（播種計画）
// ===============================

import { loadJSON } from "/common/json.js";

let rows = [];
let varietyData = [];
const INITIAL_ROWS = 12;

/* -----------------------------------------
   外部から呼ばれるエントリポイント
----------------------------------------- */
export async function renderSeedList() {
  if (rows.length === 0) {
    await initRows();
  }
  renderTable();
}

/* -----------------------------------------
   初期行＋品種データ読み込み
----------------------------------------- */
async function initRows() {
  varietyData = await loadJSON("/data/varieties.json");

  for (let i = 0; i < INITIAL_ROWS; i++) {
    rows.push({
      planSowDate: "",
      variety: "",
      cropType: "",
      trayCount: "",
      trayType: "",
      planArea: "",
      daysToPlant: "",
      planPlantDate: ""
    });
  }
}

/* -----------------------------------------
   面積計算（トレイタイプ対応）
----------------------------------------- */
function calcAreaFromTray(trayCount, trayType) {
  if (!trayCount || !trayType) return "";

  const holes = trayType === "128" ? 128 : 200; // 1枚あたりの株数
  const seedCount = trayCount * holes;

  const spacingRow = 34;
  const spacingBed = 60;

  const areaM2 = calcAreaM2(seedCount, spacingRow, spacingBed);
  const areaTan = calcAreaTan(areaM2);

  return areaTan.toFixed(2);
}


/* -----------------------------------------
   定植予定日計算
----------------------------------------- */
function calcPlanPlantDate(planSowDate, days) {
  if (!planSowDate || !days) return "";
  const d = new Date(planSowDate);
  d.setDate(d.getDate() + Number(days));
  return d.toISOString().slice(0, 10);
}

/* -----------------------------------------
   トレイタイプ選択モーダル
----------------------------------------- */
function openTrayTypeSelectModal(callback) {
  const container = document.getElementById("modal-container");
  container.style.display = "block";

  container.innerHTML = `
    <div class="modal-bg" id="tray-modal-bg">
      <div class="modal small-modal">
        <div class="modal-close" id="tray-modal-close">×</div>
        <h3>トレイタイプ選択</h3>

        <div class="tray-select-list">
          <div class="tray-option" data-type="128">128穴（標準）</div>
          <div class="tray-option" data-type="200">200穴（密植）</div>
        </div>
      </div>
    </div>
  `;

  document.getElementById("tray-modal-close").onclick = closeModal;
  document.getElementById("tray-modal-bg").onclick = e => {
    if (e.target.id === "tray-modal-bg") closeModal();
  };

  document.querySelectorAll(".tray-option").forEach(opt => {
    opt.addEventListener("click", () => {
      callback(opt.dataset.type);
      closeModal();
    });
  });
}

/* -----------------------------------------
   品種選択モーダル（計画専用）
----------------------------------------- */
function openVarietySelectModal(callback) {
  const container = document.getElementById("modal-container");
  container.style.display = "block";

  const typeMap = {};
  varietyData.forEach(v => {
    if (!typeMap[v.type]) typeMap[v.type] = [];
    typeMap[v.type].push(v);
  });

  let listHtml = "";
  Object.keys(typeMap).forEach(type => {
    listHtml += `<h4 class="variety-type-title">${type}</h4>`;
    typeMap[type].forEach(v => {
      listHtml += `
        <div class="variety-option" data-name="${v.name}" data-type="${v.type}">
          ${v.name}
        </div>
      `;
    });
  });

  container.innerHTML = `
    <div class="modal-bg" id="variety-modal-bg">
      <div class="modal small-modal">
        <div class="modal-close" id="variety-modal-close">×</div>
        <h3>品種選択</h3>
        <div class="variety-select-list">${listHtml}</div>
      </div>
    </div>
  `;

  document.getElementById("variety-modal-close").onclick = closeModal;
  document.getElementById("variety-modal-bg").onclick = e => {
    if (e.target.id === "variety-modal-bg") closeModal();
  };

  document.querySelectorAll(".variety-option").forEach(opt => {
    opt.addEventListener("click", () => {
      callback({
        name: opt.dataset.name,
        type: opt.dataset.type
      });
      closeModal();
    });
  });
}

function closeModal() {
  const container = document.getElementById("modal-container");
  container.style.display = "none";
  container.innerHTML = "";
}

/* -----------------------------------------
   テーブル描画
----------------------------------------- */
function renderTable() {
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
        </tr>
      </thead>
      <tbody>
  `;

  rows.forEach((r, i) => {
    html += `
      <tr data-index="${i}">
        <td><input type="date" class="input-sow" value="${r.planSowDate}"></td>

        <td class="variety-cell">${r.variety || "選択"}</td>

        <td><input type="number" class="input-tray" value="${r.trayCount}"></td>

        <td class="tray-type-cell">${r.trayType || "選択"}</td>

        <td>${r.planArea || ""}</td>

        <td><input type="number" class="input-days" value="${r.daysToPlant}"></td>

        <td>${r.planPlantDate || ""}</td>
      </tr>
    `;
  });

  html += `</tbody></table>`;
  tableArea.innerHTML = html;

  attachEvents();
}

/* -----------------------------------------
   イベント付与
----------------------------------------- */
function attachEvents() {
  document.querySelectorAll("tr[data-index]").forEach(tr => {
    const idx = Number(tr.dataset.index);
    const row = rows[idx];

    // 播種予定日
    tr.querySelector(".input-sow").addEventListener("change", e => {
      row.planSowDate = e.target.value;
      row.planPlantDate = calcPlanPlantDate(row.planSowDate, row.daysToPlant);
      renderTable();
    });

    // 品種選択
    tr.querySelector(".variety-cell").addEventListener("click", () => {
      openVarietySelectModal(selected => {
        row.variety = selected.name;
        row.cropType = selected.type;
        renderTable();
      });
    });

    // 枚数
    tr.querySelector(".input-tray").addEventListener("input", e => {
      row.trayCount = Number(e.target.value);
      row.planArea = calcAreaFromTray(row.trayCount, row.trayType);
      renderTable();
    });

    // トレイタイプ
    tr.querySelector(".tray-type-cell").addEventListener("click", () => {
      openTrayTypeSelectModal(type => {
        row.trayType = type;
        row.planArea = calcAreaFromTray(row.trayCount, row.trayType);
        renderTable();
      });
    });

    // 定植まで日数
    tr.querySelector(".input-days").addEventListener("input", e => {
      row.daysToPlant = Number(e.target.value);
      row.planPlantDate = calcPlanPlantDate(row.planSowDate, row.daysToPlant);
      renderTable();
    });
  });
}
