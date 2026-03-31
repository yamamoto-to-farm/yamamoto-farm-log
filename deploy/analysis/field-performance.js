// analysis/field-performance.js

import { loadJSON } from "/common/json.js?v=1.1";

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

  renderTable(rows);   // ← ★ここでテーブルに表示
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

        list.push({
          plantingRef: summary.plantingRef,
          field: summary.planting.field,
          variety: summary.planting.variety
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
        <td>-</td>   <!-- 面積は後で計算 -->
        <td>-</td>   <!-- 収量は後で計算 -->
        <td>-</td>   <!-- 反収は後で計算 -->
        <td>
          <a href="/analysis/index.html?ref=${encodeURIComponent(r.plantingRef)}">詳細</a>
        </td>
      </tr>
    `);
  });
}