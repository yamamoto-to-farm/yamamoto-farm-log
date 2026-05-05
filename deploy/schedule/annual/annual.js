// annual.js（STEP1＋STEP2 版）

import { loadJSON, saveJSON } from "/common/json.js";

/* ============================================================
   初期化
============================================================ */
window.addEventListener("DOMContentLoaded", async () => {

  const year = new URLSearchParams(location.search).get("year");
  document.getElementById("pageTitle").textContent = `${year} 年間作付計画`;

  // 既存ファイルがあれば読み込み、なければ新規
  let annual;
  try {
    annual = await loadJSON(`/logs/schedule/annual/${year}-作付計画.json`);
  } catch {
    annual = createEmptyAnnual(year);
  }

  buildStep1UI(annual);
  buildStep2UI(annual);

  document.getElementById("recalcStep1").addEventListener("click", () => {
    recalcStep1(annual);
  });

  document.getElementById("addStep2Row").addEventListener("click", () => {
    annual.step2.rows.push({
      harvestWeek: "",
      variety: "",
      targetUnits: "",
      needArea: "",
      sowDate: "",
      plantDate: ""
    });
    buildStep2UI(annual);
  });

  document.getElementById("recalcStep2").addEventListener("click", () => {
    recalcStep2(annual);
  });

  document.getElementById("save").addEventListener("click", async () => {
    await saveJSON(`/logs/schedule/annual/${year}-作付計画.json`, annual);
    document.getElementById("saveStatus").textContent = "保存しました";
  });
});

/* ============================================================
   年間作付計画オブジェクトの初期形
============================================================ */
function createEmptyAnnual(year) {
  return {
    year,
    step1: {
      months: createStep1Months()
    },
    step2: {
      rows: []
    }
  };
}

function createStep1Months() {
  // 例：11〜翌6月（8ヶ月分）
  const list = [
    "11", "12", "01", "02", "03", "04", "05", "06"
  ];
  return list.map(m => ({
    month: m,
    targetUnits: "",
    unitsPer10a: "",
    yieldPer10a: "",
    needArea: ""
  }));
}

/* ============================================================
   STEP1 UI
============================================================ */
function buildStep1UI(annual) {
  const tbody = document.getElementById("step1Body");
  tbody.innerHTML = "";

  annual.step1.months.forEach((m, idx) => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${m.month}月</td>
      <td><input data-s1="${idx}" data-k="targetUnits" value="${m.targetUnits}"></td>
      <td><input data-s1="${idx}" data-k="unitsPer10a" value="${m.unitsPer10a}"></td>
      <td><input data-s1="${idx}" data-k="yieldPer10a" value="${m.yieldPer10a}"></td>
      <td><input data-s1="${idx}" data-k="needArea" value="${m.needArea}" readonly></td>
    `;

    tbody.appendChild(tr);
  });

  tbody.querySelectorAll("input").forEach(inp => {
    if (inp.dataset.k === "needArea") return; // 計算結果は編集不可
    inp.addEventListener("input", () => {
      const i = Number(inp.dataset.s1);
      const k = inp.dataset.k;
      annual.step1.months[i][k] = inp.value;
    });
  });
}

/* ============================================================
   STEP1 再計算
   （ここではシンプルに：必要反数 = 目標基数 / 1反あたり基数）
============================================================ */
function recalcStep1(annual) {
  annual.step1.months.forEach(m => {
    const target = Number(m.targetUnits || 0);
    const per10a = Number(m.unitsPer10a || 0);

    if (target > 0 && per10a > 0) {
      m.needArea = (target / per10a).toFixed(2); // 反
    } else {
      m.needArea = "";
    }
  });
  buildStep1UI(annual);
}

/* ============================================================
   STEP2 UI
============================================================ */
function buildStep2UI(annual) {
  const tbody = document.getElementById("step2Body");
  tbody.innerHTML = "";

  annual.step2.rows.forEach((r, idx) => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td><input data-s2="${idx}" data-k="harvestWeek" value="${r.harvestWeek}"></td>
      <td><input data-s2="${idx}" data-k="variety" value="${r.variety}"></td>
      <td><input data-s2="${idx}" data-k="targetUnits" value="${r.targetUnits}"></td>
      <td><input data-s2="${idx}" data-k="needArea" value="${r.needArea}" readonly></td>
      <td><input data-s2="${idx}" data-k="sowDate" value="${r.sowDate}"></td>
      <td><input data-s2="${idx}" data-k="plantDate" value="${r.plantDate}"></td>
    `;

    tbody.appendChild(tr);
  });

  tbody.querySelectorAll("input").forEach(inp => {
    const i = Number(inp.dataset.s2);
    const k = inp.dataset.k;
    inp.addEventListener("input", () => {
      annual.step2.rows[i][k] = inp.value;
    });
  });
}

/* ============================================================
   STEP2 再計算
   ※ 本来は varieties-detail.json を参照して
      収穫週 → 定植日 → 播種日を逆算するが、
      ここではプレースホルダとして必要反数だけ計算
============================================================ */
function recalcStep2(annual) {
  annual.step2.rows.forEach(r => {
    const target = Number(r.targetUnits || 0);
    // 仮ロジック：1反あたり 5000 基と仮定
    const per10a = 5000;
    if (target > 0) {
      r.needArea = (target / per10a).toFixed(2);
    } else {
      r.needArea = "";
    }
  });
  buildStep2UI(annual);
}
