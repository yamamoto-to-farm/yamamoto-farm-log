// ===============================
// import
// ===============================
import { saveLog } from "../common/save/index.js";
import { getMachineParam } from "../common/utils.js";


// ===============================
// チェック順管理
// ===============================
let checkedOrder = [];   // 例: ["2025-02-10_ABC123", "2025-02-10_DEF456"]


// ===============================
// ページ読み込み
// ===============================
window.addEventListener("DOMContentLoaded", () => {
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById("shippingDate").value = today;

  loadUnshipped();
});


// ===============================
// CSV 読み込み
// ===============================
async function loadCSV(url) {
  try {
    const res = await fetch(url + "?ts=" + Date.now());
    const text = await res.text();
    if (!text.trim()) return [];
    return text.trim().split("\n").map(line => line.split(","));
  } catch {
    return [];
  }
}


// ===============================
// 未計量の収穫（shippingDate × plantingRef）
// ===============================
async function loadUnshipped() {
  const harvest = await loadCSV("../logs/harvest/all.csv");
  const weight  = await loadCSV("../logs/weight/all.csv");

  const harvestMap = {};
  harvest.forEach(cols => {
    const shippingDate = cols[1];
    const plantingRef  = cols[6];
    const field        = cols[3];
    const bins         = Number(cols[4]) || 0;

    const key = shippingDate + "_" + plantingRef;

    if (!harvestMap[key]) harvestMap[key] = { field, bins: 0 };
    harvestMap[key].bins += bins;
  });

  const weightMap = {};
  weight.forEach(cols => {
    const shippingDate = cols[0];
    const plantingRef  = cols[5];
    const bins         = Number(cols[2]) || 0;

    const key = shippingDate + "_" + plantingRef;

    weightMap[key] = (weightMap[key] || 0) + bins;
  });

  const unshipped = [];
  Object.keys(harvestMap).forEach(key => {
    const harvested = harvestMap[key].bins;
    const shipped   = weightMap[key] || 0;
    const remain    = harvested - shipped;

    if (remain > 0) {
      unshipped.push({
        key,
        shippingDate: key.split("_")[0],
        plantingRef:  key.split("_")[1],
        field:        harvestMap[key].field,
        remainBins:   remain
      });
    }
  });

  const area = document.getElementById("unshippedArea");
  area.innerHTML = "";

  unshipped.forEach(u => {
    const div = document.createElement("div");
    div.className = "card";

    div.innerHTML = `
      <label>
        <input type="checkbox" class="refCheck" value="${u.key}">
        ${u.shippingDate} / ${u.field} / ${u.plantingRef}
        （未計量 ${u.remainBins} 基）
      </label>
      <span class="order-label" data-key="${u.key}">順番：－</span>
    `;

    const cb = div.querySelector(".refCheck");
    cb.addEventListener("change", () => onCheckChange(u.key, cb.checked));

    area.appendChild(div);
  });
}


// ===============================
// チェック順更新
// ===============================
function onCheckChange(key, checked) {
  if (checked) {
    if (!checkedOrder.includes(key)) checkedOrder.push(key);
  } else {
    checkedOrder = checkedOrder.filter(k => k !== key);
  }
  updateOrderLabels();
}

function updateOrderLabels() {
  checkedOrder.forEach((key, idx) => {
    const label = document.querySelector(`.order-label[data-key="${key}"]`);
    if (label) label.textContent = `順番：${idx + 1}`;
  });

  document.querySelectorAll(".order-label").forEach(label => {
    const key = label.dataset.key;
    if (!checkedOrder.includes(key)) {
      label.textContent = "順番：－";
    }
  });
}


// ===============================
// 重量パース
// ===============================
function parseWeights(raw) {
  return raw
    .split(/[\s,]+/)
    .map(v => v.trim())
    .filter(v => v.length > 0)
    .map(v => Number(v))
    .filter(v => !isNaN(v));
}


// ===============================
// 必要回数（2基単位）
// ===============================
function calcRequiredCount(remainBins) {
  const full = Math.floor(remainBins / 2);
  const hasFraction = (remainBins % 2) > 0;
  return full + (hasFraction ? 1 : 0);
}


// ===============================
// 重量割当（2基単位・端数処理）
// ===============================
function allocateWeights(targets, weights) {
  for (let W of weights) {
    let remainBinsInW = 2.0;

    for (let t of targets) {
      if (remainBinsInW <= 0) break;
      if (t.remainBins <= 0) continue;

      const binsForThis = Math.min(t.remainBins, remainBinsInW);
      const weightForThis = W * (binsForThis / 2.0);

      t.totalWeight += weightForThis;
      t.remainBins  -= binsForThis;

      remainBinsInW -= binsForThis;
    }
  }
}


// ===============================
// 保存処理（修正版）
// ===============================
async function saveShipping() {
  const shippingDate = document.getElementById("shippingDate").value;
  const notes        = document.getElementById("notes").value;
  const machine      = getMachineParam();
  const human        = window.currentHuman || "";

  if (checkedOrder.length === 0) {
    alert("対象を選択してください");
    return;
  }

  const raw = document.getElementById("weights").value;
  const weightList = parseWeights(raw);
  if (weightList.length === 0) {
    alert("重量を入力してください");
    return;
  }

  const harvest = await loadCSV("../logs/harvest/all.csv");
  const weight  = await loadCSV("../logs/weight/all.csv");

  const harvestMap = {};
  harvest.forEach(cols => {
    const key  = cols[1] + "_" + cols[6];
    const field = cols[3];
    const bins  = Number(cols[4]) || 0;

    if (!harvestMap[key]) harvestMap[key] = { field, bins: 0 };
    harvestMap[key].bins += bins;
  });

  const weightMap = {};
  weight.forEach(cols => {
    const key  = cols[0] + "_" + cols[5];
    const bins = Number(cols[2]) || 0;
    weightMap[key] = (weightMap[key] || 0) + bins;
  });

  const targets = checkedOrder.map(key => {
    const harvested = harvestMap[key].bins;
    const shipped   = weightMap[key] || 0;
    const remain    = harvested - shipped;
    return {
      key,
      plantingRef: key.split("_")[1],
      field: harvestMap[key].field,
      originalRemain: remain,
      remainBins: remain,
      totalWeight: 0
    };
  });

  allocateWeights(targets, weightList);

  let csvLines = "";

  for (let t of targets) {
    const shippedBins = t.originalRemain - t.remainBins;

    const csvLine = [
      shippingDate,
      t.field,
      shippedBins,
      t.totalWeight,
      notes.replace(/[\r\n,]/g, " "),
      t.plantingRef,
      machine,
      human
    ].join(",");

    csvLines += csvLine + "\n";
  }

  await saveLog("weight", "all", {}, csvLines);

  alert("保存しました");
}

window.saveShipping = saveShipping;