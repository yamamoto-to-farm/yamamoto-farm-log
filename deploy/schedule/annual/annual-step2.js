// annual-step2.js（反計算 + 品種モーダル対応 + modal-container 自動生成）

import { openVarietyModal } from "/common/filter/filter-variety.js";

const DEBUG = true;
const log = (...a) => DEBUG && console.log(...a);

// ★ filter-ui.js が使う #modal-container を自動生成（最重要）
(function ensureModalContainer() {
  if (!document.getElementById("modal-container")) {
    const div = document.createElement("div");
    div.id = "modal-container";
    document.body.appendChild(div);
  }
})();

export function initStep2(annual) {
  log("[STEP2] init");
  buildUI(annual);

  document.getElementById("addStep2Row").addEventListener("click", () => {
    annual.step2.rows.push({
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
  });
}

function buildUI(annual) {
  const tbody = document.getElementById("step2Body");
  tbody.innerHTML = "";

  annual.step2.rows.forEach((r, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input data-i="${idx}" data-k="harvestWeek" value="${r.harvestWeek}"></td>

      <!-- ★ 品種クリックでモーダルを開く -->
      <td>
        <input class="variety-input" data-i="${idx}" data-k="variety" 
               value="${r.variety}" readonly>
      </td>

      <td><input data-i="${idx}" data-k="targetUnits" value="${r.targetUnits}"></td>
      <td><input data-i="${idx}" data-k="per10a" value="${r.per10a}"></td>
      <td><input data-i="${idx}" data-k="needArea" value="${r.needArea}" readonly></td>
      <td><input data-i="${idx}" data-k="sowDate" value="${r.sowDate}"></td>
      <td><input data-i="${idx}" data-k="plantDate" value="${r.plantDate}"></td>
    `;
    tbody.appendChild(tr);
  });

  // ★ 入力変更イベント（品種以外）
  tbody.querySelectorAll("input").forEach(inp => {
    const i = inp.dataset.i;
    const k = inp.dataset.k;

    if (inp.classList.contains("variety-input")) return;

    inp.addEventListener("input", () => {
      annual.step2.rows[i][k] = inp.value;
    });
  });

  // ★ 品種クリック → モーダル表示
  tbody.querySelectorAll(".variety-input").forEach(inp => {
    inp.addEventListener("click", () => {
      const rowIndex = inp.dataset.i;

      openVarietyModal({
        mode: "select",   // ★ 選択モード
        onSelect: (varietyName) => {
          annual.step2.rows[rowIndex].variety = varietyName;
          buildUI(annual);
        }
      });
    });
  });
}

function recalc(annual) {
  log("[STEP2] recalc");

  annual.step2.rows.forEach(r => {
    const target = Number(r.targetUnits || 0);
    const per10a = Number(r.per10a || 0);

    // ★ 必要面積(反) = 目標基数 ÷ 基/反
    r.needArea = (target > 0 && per10a > 0)
      ? (target / per10a).toFixed(2)
      : "";
  });

  buildUI(annual);
}
