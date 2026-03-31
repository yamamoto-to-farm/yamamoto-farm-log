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

  // summary-index.json から年度一覧を抽出
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

  // 次のステップで scatter plot やテーブル描画をここに追加する
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
          variety: summary.planting.variety,
          // 面積・収量・反収は次のステップで追加
        });
      }
    }
  }

  return list;
}