// analysis/field-performance.js

import { loadJSON } from "/common/json.js?v=1.1";
import { 
  calcAreaM2,
  calcAreaTan,
  calcYieldPerTan
} from "/analysis/analysis-utils.js?v=1.1";

let chart = null;

/* ===============================
   初期化
=============================== */
init();

async function init() {
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
   年度変更 → データ読み込み
=============================== */
async function loadForSelectedYear() {
  const year = Number(document.getElementById("year-select").value);

  const rows = await loadPlantingRefList(year);

  renderTable(rows);
  renderScatter(rows);
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

        // 面積（㎡ → 反）
        const areaM2 = calcAreaM2(
          Number(planting.quantity || 0),
          Number(planting.spacing.row || 0),
          Number(planting.spacing.bed || 0)
        );
        const areaTan = calcAreaTan(areaM2);

        // 収量（kg）
        const weight = Number(shipping.totalWeight || 0);

        // 反収（kg/反）
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

/* ===============================
   散布図描画（Chart.js）
=============================== */
function renderScatter(rows) {
  const canvas = document.getElementById("fieldChart");
  const ctx = canvas.getContext("2d");   // ← ★これが重要！

  // 既存チャートがあれば破棄
  if (chart) chart.destroy();

  chart = new Chart(ctx, {
    type: "scatter",
    data: {
      datasets: [{
        label: "ロット別生産性",
        data: rows.map(r => ({
          x: r.areaTan,
          y: r.yieldPerTan,
          label: r.plantingRef
        })),
        backgroundColor: "rgba(54, 162, 235, 0.7)"
      }]
    },
    options: {
      responsive: true,
      plugins: {
        tooltip: {
          callbacks: {
            label: ctx => {
              const r = rows[ctx.dataIndex];
              return [
                `plantingRef: ${r.plantingRef}`,
                `面積: ${r.areaTan.toFixed(2)}反`,
                `反収: ${r.yieldPerTan.toFixed(1)}kg/反`
              ];
            }
          }
        }
      },
      scales: {
        x: {
          title: { display: true, text: "作付面積（反）" }
        },
        y: {
          title: { display: true, text: "反収（kg/反）" }
        }
      }
    }
  });
}