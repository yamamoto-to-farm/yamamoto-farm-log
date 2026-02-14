// ===============================
// import（必ずファイル先頭）
// ===============================
import { 
  createWorkerCheckboxes,
  createFieldSelector,
  autoDetectField,
  getSelectedWorkers,
  getFinalField
} from "../common/ui.js";

import { saveLog } from "../common/save/index.js";


// ===============================
// 初期化処理
// ===============================
window.addEventListener("DOMContentLoaded", async () => {

  // 作業者チェックボックス
  createWorkerCheckboxes("workers_box");

  // 圃場セレクタ
  await createFieldSelector("field_auto", "field_area", "field_manual");

  // 自動判定
  autoDetectField("field_auto", "field_area", "field_manual");

  // イベント登録
  document.getElementById("field_manual")
    .addEventListener("change", updatePlantingRefOptions);

  document.getElementById("field_auto")
    .addEventListener("change", updatePlantingRefOptions);

  document.getElementById("field_confirm")
    .addEventListener("change", updatePlantingRefOptions);

  document.getElementById("harvestDate")
    .addEventListener("change", updatePlantingRefOptions);

  // 日付初期値
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById("harvestDate").value = today;
  document.getElementById("shippingDate").value = today;
});


// ===============================
// 定植CSV読み込み（デバッグ付き）
// ===============================
async function loadPlantingCSV() {
  const url = "../logs/planting/all.csv?ts=" + Date.now();
  console.log("📘 FETCH URL:", url);

  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    console.log("❌ fetch 失敗:", e);
    return [];
  }

  console.log("📘 fetch status:", res.status);

  const text = await res.text();
  console.log("📄 CSV raw text:", JSON.stringify(text));

  if (!text.trim()) {
    console.log("❌ CSV が空です");
    return [];
  }

  const lines = text.trim().split("\n");
  console.log("📘 lines:", lines);

  const rows = lines; // ★ ヘッダーなし
  console.log("📘 rows:", rows);

  const list = rows.map((line, i) => {
    const cols = line.split(",");
    console.log(`🔍 row ${i} cols:`, cols);

    return {
      plantDate: cols[0],
      worker: cols[1],
      field: cols[2],
      variety: cols[3],
      quantity: cols[4],
      spacingRow: cols[5],
      spacingBed: cols[6],
      harvestPlanYM: cols[7],
      notes: cols[8]
    };
  });

  console.log("🌱 loadPlantingCSV parsed:", list);
  console.log("🌱 parsed length:", list.length);

  return list;
}


// ===============================
// 収穫年月 ±1ヶ月
// ===============================
function getHarvestYMRange(harvestDate) {
  const d = new Date(harvestDate);
  const list = [];

  for (let offset = -1; offset <= 1; offset++) {
    const tmp = new Date(d);
    tmp.setMonth(tmp.getMonth() + offset);
    const ym = `${tmp.getFullYear()}-${String(tmp.getMonth() + 1).padStart(2, "0")}`;
    list.push(ym);
  }

  return list;
}


// ===============================
// 定植記録候補を更新
// ===============================
async function updatePlantingRefOptions() {
  console.log("🔥 updatePlantingRefOptions 発火");

  const field = getFinalField(); // ← common/ui.js の共通ロジック
  const harvestDate = document.getElementById("harvestDate").value;

  console.log("🧪 field:", field, "harvestDate:", harvestDate);

  if (!field || !harvestDate) return;

  const plantingList = await loadPlantingCSV();
  const ymRange = getHarvestYMRange(harvestDate);

  console.log("🧪 ymRange:", ymRange);

  const select = document.getElementById("plantingRef");
  select.innerHTML = "<option value=''>該当する定植記録を選択</option>";

  const filtered = plantingList.filter(
    p => p.field === field && ymRange.includes(p.harvestPlanYM)
  );

  console.log("🧪 filtered:", filtered);

  filtered.forEach(p => {
    const id = p.plantDate.replace(/-/g, "");
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = `${p.plantDate} / ${p.variety} / ${p.quantity}株`;
    select.appendChild(opt);
  });
}


// ===============================
// 入力データ収集
// ===============================
function collectHarvestData() {
  return {
    harvestDate: document.getElementById("harvestDate").value,
    shippingDate: document.getElementById("shippingDate").value,
    worker: getSelectedWorkers("workers_box", "temp_workers"),
    field: getFinalField(),
    amount: document.getElementById("amount").value,
    issue: document.getElementById("issue").value,
    plantingRef: document.getElementById("plantingRef").value
  };
}
//更新2026/02/14
// ===============================
// 保存処理
// ===============================
async function saveHarvestInner() {
  const data = collectHarvestData();

  if (!data.harvestDate) {
    alert("収穫日を入力してください");
    return;
  }

  const dateStr = data.harvestDate.replace(/-/g, "");

  const csvLine = [
    data.harvestDate,
    data.shippingDate,
    data.worker.replace(/,/g, "／"),
    data.field,
    data.amount,
    data.issue.replace(/[\r\n,]/g, " "),
    data.plantingRef
  ].join(",");

  await saveLog("harvest", dateStr, data, csvLine);

  alert("GitHubに保存しました");
}

window.saveHarvest = saveHarvestInner;