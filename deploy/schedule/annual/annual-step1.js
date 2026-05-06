// annual-step1.js（反で計算・テンキー最適化・年間サマリー付き）

const DEBUG = false;
const log = (...a) => DEBUG && console.log(...a);

export function initStep1(annual) {
  log("[STEP1] init");
  buildUI(annual);
  updateStep1Summary(annual);

  document.getElementById("recalcStep1").addEventListener("click", () => {
    recalc(annual);
  });
}

/* ============================================================
   UI構築
============================================================ */
function buildUI(annual) {
  const tbody = document.getElementById("step1Body");
  tbody.innerHTML = "";

  annual.step1.months.forEach((m, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${m.month.slice(5)}月</td>

      <td>
        <input 
          type="text" inputmode="numeric" pattern="[0-9]*"
          data-i="${idx}" data-k="targetUnits" 
          value="${m.targetUnits}">
      </td>

      <td>
        <input 
          type="text" inputmode="numeric" pattern="[0-9]*"
          data-i="${idx}" data-k="unitsPer10a" 
          value="${m.unitsPer10a}">
      </td>

      <td>
        <input 
          type="text" inputmode="numeric" pattern="[0-9]*"
          data-i="${idx}" data-k="yieldPer10a" 
          value="${m.yieldPer10a}">
      </td>

      <td>
        <input 
          type="text" inputmode="numeric" pattern="[0-9]*"
          data-i="${idx}" data-k="needArea" 
          value="${m.needArea}" readonly>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // ★ 入力変更イベント（必要面積以外）
  tbody.querySelectorAll("input").forEach(inp => {
    if (inp.dataset.k === "needArea") return;

    inp.addEventListener("input", () => {
      const i = inp.dataset.i;
      const k = inp.dataset.k;
      annual.step1.months[i][k] = inp.value;

      updateStep1Summary(annual); // ★ 入力時にサマリー更新
    });
  });
}

/* ============================================================
   年間サマリー表示
============================================================ */
function updateStep1Summary(annual) {
  let summary = document.getElementById("step1-summary");

  if (!summary) {
    summary = document.createElement("div");
    summary.id = "step1-summary";
    summary.style.margin = "10px 0";
    summary.style.padding = "10px";
    summary.style.background = "#f5f5f5";
    summary.style.borderRadius = "6px";

    const step1 = document.getElementById("step1");
    step1.insertBefore(summary, step1.children[1]); // h2 の直下に挿入
  }

  // ★ 集計
  let totalUnits = 0;
  let totalArea = 0;
  let totalYieldKg = 0;

  annual.step1.months.forEach(m => {
    const units = Number(m.targetUnits || 0);
    const area = Number(m.needArea || 0);
    const yieldPer10a = Number(m.yieldPer10a || 0);

    totalUnits += units;
    totalArea += area;
    totalYieldKg += yieldPer10a * area;
  });

  const totalYieldT = (totalYieldKg / 1000).toFixed(1);

  summary.innerHTML = `
    <div><b>【年間サマリー】</b></div>
    ・年間目標基数：${totalUnits} 基<br>
    ・年間必要面積：${totalArea.toFixed(2)} 反<br>
    ・総収量：${totalYieldT} t
  `;
}

/* ============================================================
   再計算
============================================================ */
function recalc(annual) {
  log("[STEP1] recalc");

  annual.step1.months.forEach(m => {
    const target = Number(m.targetUnits || 0);
    const per10a = Number(m.unitsPer10a || 0);

    m.needArea = (target > 0 && per10a > 0)
      ? (target / per10a).toFixed(2)
      : "";
  });

  buildUI(annual);
  updateStep1Summary(annual); // ★ 再計算後も更新
}
