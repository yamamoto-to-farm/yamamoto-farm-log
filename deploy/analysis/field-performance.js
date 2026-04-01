// analysis/field-performance.js

import { loadJSON } from "/common/json.js?v=1.1";
import { 
  calcAreaM2,
  calcAreaTan,
  calcYieldPerTan
} from "/analysis/analysis-utils.js?v=1.1";

/* ===============================
   初期化
=============================== */
init();

async function init() {
  console.log("=== field-performance init ===");

  await setupYearSelector();
  await loadForSelectedYear();
}

/* ===============================
   年度セレクタのセットアップ
=============================== */
async function setupYearSelector() {
  const index = await loadJSON("/data/summary-index.json");
  const years = new Set();

  for (const field in index) {
    for (const y in index[field]) {
      years.add(Number(y));
    }
  }

  const sorted = [...years].sort((a, b) => b - a);
  const sel = document.getElementById("year-select");

  sorted.forEach(y => {
    const opt = document.createElement("option");
    opt.value = y;
    opt.textContent = `${y}年`;
    sel.appendChild(opt);
  });

  sel.addEventListener("change", loadForSelectedYear);
}

/* ===============================
   年度変更 → plantingRef 読み込み
=============================== */
async function loadForSelectedYear() {
  const year = Number(document.getElementById("year-select").value);
  console.log("=== loadForSelectedYear:", year);

  const rows = await loadPlantingRefList(year);

  console.log("=== plantingRef rows ===");
  console.table(rows);

  renderTable(rows);
}

/* ===============================
   plantingRef ごとのデータ読み込み
=============================== */
async function loadPlantingRefList(year) {
  const index = await loadJSON("/data/summary-index.json");
  const list = [];

  for (const field in index) {
    for (const y in index[field]) {
      if (Number(y) !== year) continue;

      for (const file of index[field][y]) {
        const summary = await loadJSON(`/logs/summary/${field}/${y}/${file}`);

        const planting = summary.planting;
        const shipping = summary.shipping;

        // --- 面積（㎡ → 反） ---
        const areaM2 = calcAreaM2(
          Number(planting.quantity || 0),
          Number(planting.spacing.row || 0),
          Number(planting.spacing.bed || 0)
        );

        const areaTan = calcAreaTan(areaM2); // 反（小数）

        // --- 収量（kg） ---
        const weight = Number(shipping.totalWeight || 0);

        // --- 反収（kg/反） ---
        const yieldPerTan = Number(calcYieldPerTan(weight, areaTan));

        list.push({
          plantingRef: summary.plantingRef,
          field: planting.field,
          variety: planting.variety,
          areaTan,
          weight,
          yieldPerTan
        });
      }
    }
  }

  return list;
}

/* ===============================
   テーブル描画
=============================== */
function renderTable(rows) {
  const tbody = document.getElementById("field-table-body");
  tbody.innerHTML = "";

  rows.forEach(r => {
    tbody.insertAdjacentHTML("beforeend", `
      <tr>
        <td>${r.plantingRef}</td>
        <td>${r.field}</td>
        <td>${r.variety}</td>
        <td>${r.areaTan.toFixed(2)}</td>
        <td>${r.weight.toLocaleString()}</td>
        <td>${r.yieldPerTan.toFixed(1)}</td>
        <td>
          <a href="/analysis/index.html?ref=${encodeURIComponent(r.plantingRef)}">詳細</a>
        </td>
      </tr>
    `);
  });
}