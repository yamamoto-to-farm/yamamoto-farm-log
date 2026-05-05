// annual-step1.js（反で計算する版）

const DEBUG = true;
const log = (...a) => DEBUG && console.log(...a);

export function initStep1(annual) {
  log("[STEP1] init");
  buildUI(annual);

  document.getElementById("recalcStep1").addEventListener("click", () => {
    recalc(annual);
  });
}

function buildUI(annual) {
  const tbody = document.getElementById("step1Body");
  tbody.innerHTML = "";

  annual.step1.months.forEach((m, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${m.month}月</td>
      <td><input data-i="${idx}" data-k="targetUnits" value="${m.targetUnits}"></td>
      <td><input data-i="${idx}" data-k="unitsPer10a" value="${m.unitsPer10a}"></td>
      <td><input data-i="${idx}" data-k="yieldPer10a" value="${m.yieldPer10a}"></td>
      <td><input data-i="${idx}" data-k="needArea" value="${m.needArea}" readonly></td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll("input").forEach(inp => {
    if (inp.dataset.k === "needArea") return;
    inp.addEventListener("input", () => {
      const i = inp.dataset.i;
      const k = inp.dataset.k;
      annual.step1.months[i][k] = inp.value;
    });
  });
}

function recalc(annual) {
  log("[STEP1] recalc");

  annual.step1.months.forEach(m => {
    const target = Number(m.targetUnits || 0);   // 目標基数
    const per10a = Number(m.unitsPer10a || 0);  // 基/反

    // ★ 必要面積(反) = 目標基数 ÷ 基/反
    m.needArea = (target > 0 && per10a > 0)
      ? (target / per10a).toFixed(2)
      : "";
  });

  buildUI(annual);
}
