// annual-step2.js（STEP1連動・月選択式UI・差分チェック・行削除対応・テンキー最適化・入力体験統一）

import { openVarietyModal } from "/common/filter/filter-variety.js";

const DEBUG = false;
const log = (...a) => DEBUG && console.log(...a);

// ★ filter-ui.js が使う #modal-container を自動生成
(function ensureModalContainer() {
  if (!document.getElementById("modal-container")) {
    const div = document.createElement("div");
    div.id = "modal-container";
    document.body.appendChild(div);
  }
})();

let currentMonth = "11"; // 初期値（11月）

export function initStep2(annual) {
  log("[STEP2] init");

  setupMonthSelector(annual);
  buildUI(annual);

  document.getElementById("addStep2Row").addEventListener("click", () => {
    annual.step2.rows.push({
      month: currentMonth,
      harvestWeek: "",
      variety: "",
      targetUnits: "",
      per10a: "",
      needArea: "",
      sowDate: "",
      plantDate: ""
    });
    buildUI(annual);
  });

  document.getElementById("recalcStep2").addEventListener("click", () => {
    recalc(annual);
    buildUI(annual); // ← 再描画はここだけ
  });
}

/* ============================================================
   月選択 UI
============================================================ */
function setupMonthSelector(annual) {
  const months = annual.step1.months.map(m => m.month);

  const selector = document.createElement("select");
  selector.id = "step2-month-selector";

  months.forEach(m => {
    const op = document.createElement("option");
    op.value = m;
    op.textContent = `${m}月`;
    selector.appendChild(op);
  });

  selector.value = currentMonth;

  selector.addEventListener("change", () => {
    currentMonth = selector.value;
    buildUI(annual);
  });

  const step2 = document.getElementById("step2");
  step2.insertBefore(selector, step2.children[1]);
}

/* ============================================================
   UI構築
============================================================ */
function buildUI(annual) {
  const tbody = document.getElementById("step2Body");
  tbody.innerHTML = "";

  const monthData = annual.step1.months.find(m => m.month === currentMonth);
  const targetUnitsMonth = Number(monthData.targetUnits || 0);
  const needAreaMonth = Number(monthData.needArea || 0);

  const rows = annual.step2.rows.filter(r => r.month === currentMonth);

  let sumUnits = 0;
  let sumArea = 0;

  rows.forEach((r, idx) => {
    sumUnits += Number(r.targetUnits || 0);
    sumArea += Number(r.needArea || 0);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <select data-i="${idx}" data-k="harvestWeek">
          <option value=""></option>
          <option value="1" ${r.harvestWeek == 1 ? "selected" : ""}>1</option>
          <option value="2" ${r.harvestWeek == 2 ? "selected" : ""}>2</option>
          <option value="3" ${r.harvestWeek == 3 ? "selected" : ""}>3</option>
          <option value="4" ${r.harvestWeek == 4 ? "selected" : ""}>4</option>
        </select>
      </td>

      <td>
        <input class="variety-input" data-i="${idx}" data-k="variety"
               value="${r.variety}" readonly>
      </td>

      <!-- ★ STEP1 と完全統一したテンキー入力 -->
      <td>
        <input 
          type="text" inputmode="numeric" pattern="[0-9]*"
          data-i="${idx}" data-k="targetUnits"
          value="${r.targetUnits}">
      </td>

      <td>
        <input 
          type="text" inputmode="numeric" pattern="[0-9]*"
          data-i="${idx}" data-k="per10a"
          value="${r.per10a}">
      </td>

      <td>
        <input 
          type="text" inputmode="numeric" pattern="[0-9]*"
          data-i="${idx}" data-k="needArea"
          value="${r.needArea}" readonly>
      </td>

      <td>
        <input type="date" data-i="${idx}" data-k="sowDate" value="${r.sowDate}">
      </td>

      <td>
        <input type="date" data-i="${idx}" data-k="plantDate" value="${r.plantDate}">
      </td>

      <td><button class="delete-row" data-i="${idx}">削除</button></td>
    `;
    tbody.appendChild(tr);
  });

  updateSummary(targetUnitsMonth, needAreaMonth, sumUnits, sumArea);

  // ★ 入力イベント（buildUI を呼ばない）
  tbody.querySelectorAll("input, select").forEach(inp => {
    const i = inp.dataset.i;
    const k = inp.dataset.k;

    if (inp.classList.contains("variety-input")) return;

    inp.addEventListener("input", () => {
      const row = annual.step2.rows.filter(r => r.month === currentMonth)[i];
      row[k] = inp.value;

      recalc(annual); // 計算のみ（UI再描画なし）

      updateSummary(
        targetUnitsMonth,
        needAreaMonth,
        calcSumUnits(annual),
        calcSumArea(annual)
      );
    });
  });

  // ★ 品種選択
  tbody.querySelectorAll(".variety-input").forEach(inp => {
    inp.addEventListener("click", () => {
      const i = inp.dataset.i;
      const row = annual.step2.rows.filter(r => r.month === currentMonth)[i];

      openVarietyModal({
        mode: "select",
        onSelect: (name) => {
          row.variety = name;
          buildUI(annual);
        }
      });
    });
  });

  // ★ 行削除
  tbody.querySelectorAll(".delete-row").forEach(btn => {
    btn.addEventListener("click", () => {
      const i = btn.dataset.i;
      const rowsAll = annual.step2.rows.filter(r => r.month === currentMonth);
      const targetRow = rowsAll[i];

      const indexInAll = annual.step2.rows.indexOf(targetRow);
      annual.step2.rows.splice(indexInAll, 1);

      buildUI(annual);
    });
  });
}

/* ============================================================
   合計計算（UI再描画なし）
============================================================ */
function calcSumUnits(annual) {
  return annual.step2.rows
    .filter(r => r.month === currentMonth)
    .reduce((a, b) => a + Number(b.targetUnits || 0), 0);
}

function calcSumArea(annual) {
  return annual.step2.rows
    .filter(r => r.month === currentMonth)
    .reduce((a, b) => a + Number(b.needArea || 0), 0);
}

/* ============================================================
   月内合計の差分表示
============================================================ */
function updateSummary(targetUnits, needArea, sumUnits, sumArea) {
  let summary = document.getElementById("step2-summary");
  if (!summary) {
    summary = document.createElement("div");
    summary.id = "step2-summary";
    summary.style.margin = "10px 0";
    summary.style.padding = "10px";
    summary.style.background = "#f5f5f5";
    summary.style.borderRadius = "6px";

    const step2 = document.getElementById("step2");
    step2.insertBefore(summary, step2.children[2]);
  }

  summary.innerHTML = `
    <div><b>${currentMonth}月の目標</b></div>
    ・目標基数：${targetUnits} 基  
    ・必要面積：${needArea} 反  

    <div style="margin-top:6px;"><b>現在の合計</b></div>
    ・入力基数：${sumUnits} 基（${sumUnits - targetUnits}）  
    ・入力面積：${sumArea.toFixed(2)} 反（${(sumArea - needArea).toFixed(2)}）  
  `;
}

/* ============================================================
   再計算（UI再描画しない）
============================================================ */
function recalc(annual) {
  const rows = annual.step2.rows.filter(r => r.month === currentMonth);

  rows.forEach(r => {
    const target = Number(r.targetUnits || 0);
    const per10a = Number(r.per10a || 0);

    r.needArea = (target > 0 && per10a > 0)
      ? (target / per10a).toFixed(2)
      : "";
  });
}
