// ===============================
// import
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
import { showPinGate } from "../common/ui.js";

window.addEventListener("DOMContentLoaded", () => {
  showPinGate("pin-area", () => {
    document.getElementById("form-area").style.display = "block";
  });
});


// ===============================
// 初期化
// ===============================
window.addEventListener("DOMContentLoaded", async () => {

  createWorkerCheckboxes("workers_box");

  await createFieldSelector("field_auto", "field_area", "field_manual");

  autoDetectField("field_auto", "field_area", "field_manual");

  document.getElementById("field_manual")
    .addEventListener("change", updateHarvestOptions);

  document.getElementById("field_auto")
    .addEventListener("change", updateHarvestOptions);

  document.getElementById("field_confirm")
    .addEventListener("change", updateHarvestOptions);

  const today = new Date().toISOString().slice(0, 10);
  document.getElementById("shippingDate").value = today;
});


// ===============================
// harvest CSV 読み込み
// ===============================
async function loadHarvestCSV() {
  const url = "../logs/harvest/all.csv?ts=" + Date.now();
  let res;

  try {
    res = await fetch(url);
  } catch (e) {
    return [];
  }

  const text = await res.text();
  if (!text.trim()) return [];

  const lines = text.trim().split("\n");

  return lines.map(line => {
    const cols = line.split(",");

    return {
      harvestDate: cols[0],
      shippingDate: cols[1],
      worker: cols[2],
      field: cols[3],
      bins: cols[4],
      issue: cols[5],
      plantingRef: cols[6],   // ★ harvest の plantingRef をそのまま使う
      machine: cols[7],
      human: cols[8]
    };
  });
}


// ===============================
// 圃場の収穫一覧を更新
// ===============================
async function updateHarvestOptions() {
  const field = getFinalField();
  if (!field) return;

  const harvestList = await loadHarvestCSV();

  const select = document.getElementById("harvestRef");
  select.innerHTML = "<option value=''>収穫記録を選択</option>";

  const filtered = harvestList.filter(h => h.field === field);

  filtered.forEach(h => {
    const opt = document.createElement("option");
    opt.value = h.plantingRef;   // ★ shipping にも plantingRef を渡す
    opt.textContent = `${h.harvestDate} / ${h.bins}基`;
    select.appendChild(opt);
  });
}


// ===============================
// 入力データ収集
// ===============================
function collectShippingData() {
  return {
    shippingDate: document.getElementById("shippingDate").value,
    worker: getSelectedWorkers("workers_box", "temp_workers"),
    field: getFinalField(),
    weight: document.getElementById("weight").value,
    notes: document.getElementById("notes").value,
    plantingRef: document.getElementById("harvestRef").value   // ★ harvest の plantingRef を継承
  };
}


// ===============================
// 保存処理
// ===============================
async function saveShippingInner() {
  const data = collectShippingData();

  if (!data.shippingDate) {
    alert("出荷日を入力してください");
    return;
  }

  const machine = getMachineParam();
  const human = window.currentHuman || "";

  const dateStr = data.shippingDate.replace(/-/g, "");

  const csvLine = [
    data.shippingDate,
    data.field,
    data.weight,
    data.notes.replace(/[\r\n,]/g, " "),
    data.plantingRef,   // ★ ここが重要
    machine,
    human
  ].join(",");

  await saveLog("shipping", dateStr, data, csvLine);

  alert("GitHubに保存しました");
}

window.saveShipping = saveShippingInner;