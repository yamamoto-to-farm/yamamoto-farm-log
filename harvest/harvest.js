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
// 畑名称ゆらぎ吸収
// ===============================
function normalizeFieldName(name) {
  if (!name) return "";
  return name
    .replace(/[（）]/g, s => (s === "（" ? "(" : ")"))
    .replace(/\s+/g, "")
    .trim();
}


// ===============================
// planting CSV キャッシュ
// ===============================
let plantingCache = null;


// ===============================
// 初期化処理（認証後に index.html から呼ばれる）
// ===============================
export async function initHarvestPage() {
  console.log("🔥 initHarvestPage() 開始");

  createWorkerCheckboxes("workers_box");
  await createFieldSelector("field_auto", "field_area", "field_manual");
  autoDetectField("field_auto", "field_area", "field_manual");

  document.getElementById("field_manual")
    .addEventListener("change", updatePlantingRefOptions);
  document.getElementById("field_auto")
    .addEventListener("change", updatePlantingRefOptions);
  document.getElementById("field_confirm")
    .addEventListener("change", updatePlantingRefOptions);
  document.getElementById("harvestDate")
    .addEventListener("change", updatePlantingRefOptions);

  const today = new Date().toISOString().slice(0, 10);
  document.getElementById("harvestDate").value = today;
  document.getElementById("shippingDate").value = today;

  console.log("🔥 initHarvestPage() 完了");
}


// ===============================
// ★ 定植CSV読み込み（ヘッダー対応＋キャッシュ）
// ===============================
async function loadPlantingCSV() {
  if (plantingCache) return plantingCache;

  const url = "../logs/planting/all.csv?ts=" + Date.now();
  console.log("📥 loadPlantingCSV:", url);

  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    console.error("❌ fetch失敗:", e);
    return [];
  }

  const text = await res.text();
  if (!text.trim()) return [];

  const lines = text.trim().split("\n");
  const headers = lines[0].split(",");

  const rows = lines.slice(1).map(line => {
    const cols = line.split(",");
    const obj = {};
    headers.forEach((h, i) => (obj[h] = cols[i] || ""));
    return obj;
  });

  plantingCache = rows;
  return rows;
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
  console.log("🔄 updatePlantingRefOptions()");

  const field = getFinalField();
  const harvestDate = document.getElementById("harvestDate").value;
  const select = document.getElementById("plantingRef");

  select.innerHTML = "<option value=''>該当する定植記録を選択</option>";

  if (!field || !harvestDate) return;

  const plantingList = await loadPlantingCSV();
  const ymRange = getHarvestYMRange(harvestDate);
  const nf = normalizeFieldName(field);

  const filtered = plantingList.filter(p => {
    const pf = normalizeFieldName(p.field || "");
    return nf === pf && ymRange.includes(p.harvestPlanYM);
  });

  filtered.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.plantingRef;
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


// ===============================
// ★ 保存処理（ヘッダー対応版）
// ===============================
async function saveHarvestInner() {
  console.log("💾 saveHarvestInner()");

  const data = collectHarvestData();

  if (!data.harvestDate) {
    alert("収穫日を入力してください");
    return;
  }
  if (!data.plantingRef) {
    alert("定植記録を選択してください");
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

  const header =
    "harvestDate,shippingDate,worker,field,bins,issue,plantingRef,machine,human\n";

  await saveLog("harvest", dateStr, data, {
    header,
    line: csvLine + "\n"
  });

  alert("GitHubに保存しました");
}

window.saveHarvest = saveHarvestInner;