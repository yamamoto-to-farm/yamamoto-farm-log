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
import { checkDuplicate } from "../common/duplicate.js";


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
// ★ 定植候補更新（畑名一致 × 生育日数 ±60 ＋ fallback）
// ===============================
async function updatePlantingRefOptions() {
  console.log("🔄 updatePlantingRefOptions()");

  const field = getFinalField();
  const harvestDate = document.getElementById("harvestDate").value;
  const select = document.getElementById("plantingRef");

  select.innerHTML = "<option value=''>該当する定植記録を選択</option>";

  if (!field || !harvestDate) return;

  const plantingList = await loadPlantingCSV();
  const nf = normalizeFieldName(field);

  // ① 畑名一致
  const candidates = plantingList.filter(p =>
    normalizeFieldName(p.field || "") === nf
  );

  if (candidates.length === 0) return;

  // ② 生育日数ロジック（±60）
  const strongMatches = candidates.filter(p => {
    if (!p.plantDate) return false;

    const actualDays = diffDays(harvestDate, p.plantDate);
    const plannedDays = calcPlannedDays(p.plantDate, p.harvestPlanYM);

    if (plannedDays === null) return false;

    return Math.abs(actualDays - plannedDays) <= 60;
  });

  // ③ strongMatches があればそれを使う
  //    なければ fallback として candidates を使う
  let finalList = strongMatches.length > 0 ? strongMatches : candidates;

  // ④ 日付降順で並べる
  finalList.sort((a, b) => new Date(b.plantDate) - new Date(a.plantDate));

  // ⑤ プルダウンに追加
  finalList.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.plantingRef;
    opt.textContent = `${p.plantDate} / ${p.variety} / ${p.quantity}株`;
    select.appendChild(opt);
  });

  // ⑥ 候補が1件なら自動選択
  if (finalList.length === 1) {
    select.value = finalList[0].plantingRef;
    console.log("✨ 候補1件 → 自動選択:", finalList[0].plantingRef);
  }
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
// 保存処理
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

  // 重複チェック
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

  await saveLog("harvest", dateStr, {
    plantingRef: data.plantingRef
  }, {
    line: csvLine + "\n"
  });

  alert("GitHubに保存しました");
}

window.saveHarvest = saveHarvestInner;