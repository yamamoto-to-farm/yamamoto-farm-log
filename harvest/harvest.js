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
import { getMachineParam } from "../common/utils.js";


// ===============================
// 初期化処理（認証後に index.html から呼ばれる）
// ===============================
export async function initHarvestPage() {
  console.log("🔥 initHarvestPage() 開始");

  // 作業者チェックボックス
  console.log("→ createWorkerCheckboxes()");
  createWorkerCheckboxes("workers_box");

  // 圃場セレクタ
  console.log("→ createFieldSelector()");
  await createFieldSelector("field_auto", "field_area", "field_manual");

  // 自動判定
  console.log("→ autoDetectField()");
  autoDetectField("field_auto", "field_area", "field_manual");

  // イベント登録
  console.log("→ イベント登録");
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

  console.log("🔥 initHarvestPage() 完了");
}


// ===============================
// ★ 定植CSV読み込み（ヘッダー対応版）
// ===============================
async function loadPlantingCSV() {
  const url = "../logs/planting/all.csv?ts=" + Date.now();
  console.log("📥 loadPlantingCSV() 読み込み開始:", url);

  let res;
  try {
    res = await fetch(url);
    console.log("📡 fetch status:", res.status);
  } catch (e) {
    console.error("❌ fetch失敗:", e);
    return [];
  }

  const text = await res.text();
  console.log("📄 CSV先頭100文字:", JSON.stringify(text.slice(0, 100)));

  if (!text.trim()) {
    console.warn("⚠️ CSV が空");
    return [];
  }

  const lines = text.trim().split("\n");
  console.log("📊 行数:", lines.length);

  const headers = lines[0].split(",");
  console.log("🧩 ヘッダー:", headers);

  const rows = lines.slice(1).map(line => {
    const cols = line.split(",");
    const obj = {};
    headers.forEach((h, i) => obj[h] = cols[i] || "");
    return obj;
  });

  console.log("✅ パース後1行目:", rows[0]);
  console.log("📦 読み込み件数:", rows.length);

  return rows;
}


// ===============================
// 収穫年月 ±1ヶ月
// ===============================
function getHarvestYMRange(harvestDate) {
  console.log("🗓 getHarvestYMRange()", harvestDate);

  const d = new Date(harvestDate);
  const list = [];

  for (let offset = -1; offset <= 1; offset++) {
    const tmp = new Date(d);
    tmp.setMonth(tmp.getMonth() + offset);
    const ym = `${tmp.getFullYear()}-${String(tmp.getMonth() + 1).padStart(2, "0")}`;
    list.push(ym);
  }

  console.log("→ YM Range:", list);
  return list;
}


// ===============================
// 定植記録候補を更新
// ===============================
async function updatePlantingRefOptions() {
  console.log("🔄 updatePlantingRefOptions() 発火");

  const field = getFinalField();
  const harvestDate = document.getElementById("harvestDate").value;

  console.log("→ field:", field);
  console.log("→ harvestDate:", harvestDate);

  if (!field || !harvestDate) {
    console.warn("⚠️ field or harvestDate が未入力");
    return;
  }

  const plantingList = await loadPlantingCSV();
  console.log("→ plantingList 件数:", plantingList.length);

  const ymRange = getHarvestYMRange(harvestDate);

  const select = document.getElementById("plantingRef");
  select.innerHTML = "<option value=''>該当する定植記録を選択</option>";

  const filtered = plantingList.filter(
    p => p.field === field && ymRange.includes(p.harvestPlanYM)
  );

  console.log("🎯 フィルタ結果:", filtered.length, "件");

  filtered.forEach(p => {
    const id = p.plantingRef;
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = `${p.plantDate} / ${p.variety} / ${p.quantity}株`;
    select.appendChild(opt);
  });

  console.log("🔚 updatePlantingRefOptions() 完了");
}


// ===============================
// 入力データ収集
// ===============================
function collectHarvestData() {
  console.log("📦 collectHarvestData()");

  const data = {
    harvestDate: document.getElementById("harvestDate").value,
    shippingDate: document.getElementById("shippingDate").value,
    worker: getSelectedWorkers("workers_box", "temp_workers"),
    field: getFinalField(),
    amount: document.getElementById("amount").value,
    issue: document.getElementById("issue").value,
    plantingRef: document.getElementById("plantingRef").value
  };

  console.log("→ data:", data);
  return data;
}


// ===============================
// ★ 保存処理（ヘッダー対応版）
// ===============================
async function saveHarvestInner() {
  console.log("💾 saveHarvestInner() 開始");

  const data = collectHarvestData();

  if (!data.harvestDate) {
    alert("収穫日を入力してください");
    console.warn("❌ harvestDate が空");
    return;
  }

  const machine = getMachineParam();
  const human = window.currentHuman || "";

  const dateStr = data.harvestDate.replace(/-/g, "");

  const csvLine = [
    data.harvestDate,
    data.shippingDate,
    data.worker.replace(/,/g, "／"),
    data.field,
    data.amount,
    data.issue.replace(/[\r\n,]/g, " "),
    data.plantingRef,
    machine,
    human
  ].join(",");

  console.log("📝 CSV行:", csvLine);

  // ★ ヘッダー行
  const header =
    "harvestDate,shippingDate,worker,field,bins,issue,plantingRef,machine,human\n";

  console.log("📤 saveLog() 実行");

  await saveLog("harvest", dateStr, data, {
    header,
    line: csvLine + "\n"
  });

  console.log("✅ saveLog 完了");
  alert("GitHubに保存しました");
}

window.saveHarvest = saveHarvestInner;