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

import { saveLog, registerSavingStart, registerSavingEnd } from "../common/save/index.js";
import { getMachineParam } from "../common/utils.js";
import { checkDuplicate } from "../common/duplicate.js";

// ★ サマリー自動更新
import { enqueueSummaryUpdate } from "../common/summary.js";


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
// 日数差を計算
// ===============================
function diffDays(dateA, dateB) {
  const a = new Date(dateA);
  const b = new Date(dateB);
  return Math.floor((a - b) / 86400000);
}


// ===============================
// 予定日数を YM から推定
// ===============================
function calcPlannedDays(plantDate, harvestPlanYM) {
  if (!plantDate) return null;
  if (!harvestPlanYM || !harvestPlanYM.includes("-")) return null;

  const [y, m] = harvestPlanYM.split("-");
  const plannedHarvest = new Date(`${y}-${m}-01`);

  return diffDays(plannedHarvest, plantDate);
}


// ===============================
// planting CSV キャッシュ
// ===============================
let plantingCache = null;


// ===============================
// 初期化
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
// planting CSV 読み込み
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
// ★ 定植候補更新
// ===============================
async function updatePlantingRefOptions() {
  console.log("🔄 updatePlantingRefOptions() START");

  const field = getFinalField();
  const harvestDate = document.getElementById("harvestDate").value;
  const select = document.getElementById("plantingRef");

  select.innerHTML = "<option value=''>該当する定植記録を選択</option>";

  if (!field || !harvestDate) {
    console.log("❌ field or harvestDate が未入力");
    return;
  }

  const plantingList = await loadPlantingCSV();
  const nf = normalizeFieldName(field);

  const candidates = plantingList.filter(p =>
    normalizeFieldName(p.field || "") === nf
  );

  if (candidates.length === 0) return;

  const strongMatches = candidates.filter(p => {
    if (!p.plantDate) return false;

    const actualDays = diffDays(harvestDate, p.plantDate);
    const plannedDays = calcPlannedDays(p.plantDate, p.harvestPlanYM);

    if (plannedDays === null) return false;
    return Math.abs(actualDays - plannedDays) <= 60;
  });

  let finalList = strongMatches.length > 0 ? strongMatches : candidates;

  finalList.sort((a, b) => new Date(b.plantDate) - new Date(a.plantDate));

  finalList.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.plantingRef;
    opt.textContent = `${p.plantDate} / ${p.variety} / ${p.quantity}株`;
    select.appendChild(opt);
  });

  if (finalList.length === 1) {
    select.value = finalList[0].plantingRef;
  }

  console.log("🔄 updatePlantingRefOptions() END");
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
// 保存処理（★サマリー自動更新つき）
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

  const dup = await checkDuplicate("harvest", {
    plantingRef: data.plantingRef,
    harvestDate: data.harvestDate,
    shippingDate: data.shippingDate,
    amount: data.amount
  });

  if (!dup.ok) {
    alert(dup.message);
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

  await saveLog(
    "harvest",
    dateStr,
    { plantingRefs: [data.plantingRef] },
    csvLine + "\n"
  );

  setTimeout(() => {
    enqueueSummaryUpdate(data.plantingRef);
  }, 1000);

  alert(
    `収穫ログを保存しました\n\n` +
    `定植: ${data.plantingRef}\n` +
    `収穫日: ${data.harvestDate}\n` +
    `出荷日: ${data.shippingDate}\n` +
    `畑: ${data.field}\n` +
    `収穫量: ${data.amount}\n` +
    `作業者: ${data.worker}\n` +
    `備考: ${data.issue || "なし"}`
  );
}

window.saveHarvest = saveHarvestInner;


// ===============================
// ★ UI フック登録（保存中ロック）
// ===============================
registerSavingStart(() => {
  const btn = document.querySelector(".primary-btn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "保存中…";
  }
  const indicator = document.getElementById("saving-indicator");
  if (indicator) indicator.style.display = "block";
});

registerSavingEnd(() => {
  const btn = document.querySelector(".primary-btn");
  if (btn) {
    btn.disabled = false;
    btn.textContent = "GitHub に保存する";
  }
  const indicator = document.getElementById("saving-indicator");
  if (indicator) indicator.style.display = "none";
});