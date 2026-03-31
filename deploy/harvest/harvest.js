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

// ★ サマリー自動更新
import { enqueueSummaryUpdate } from "../common/summary.js";

// ★ 保存モーダル
import {
  showSaveModal,
  updateSaveModal,
  completeSaveModal
} from "../common/save-modal.js";
import { showSaveAlert } from "../common/alert-utils.js";



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
// planting CSV 読み込み（CloudFront）
// ===============================
async function loadPlantingCSV() {
  if (plantingCache) return plantingCache;

  const url = "../logs/planting/all.csv?ts=" + Date.now();
  const res = await fetch(url);
  const text = await res.text();
  if (!text.trim()) return [];

  const lines = text.trim().split("\n");

  const headers = lines[0].split(",").map(h => h.replace(/\r$/, ""));

  const rows = lines.slice(1).map(line => {
    let cols = line.split(",");
    cols = cols.map(c => c.replace(/\r$/, ""));
    while (cols.length < headers.length) cols.push("");

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
// ★ harvest/all.csv を replace 方式で保存（モーダル対応版）
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

  // ★ モーダル開始
  showSaveModal("保存しています…");

  // ★ harvest/all.csv を読み込む
  const url = "../logs/harvest/all.csv?ts=" + Date.now();
  const res = await fetch(url);
  const text = await res.text();

  let rows = [];
  if (text.trim()) {
    rows = Papa.parse(text, {
      header: true,
      skipEmptyLines: true
    }).data;
  }

  // ★ 新しい行を追加
  rows.push({
    harvestDate: data.harvestDate,
    shippingDate: data.shippingDate,
    worker: data.worker.replace(/,/g, "／"),
    field: data.field,
    amount: data.amount,
    issue: data.issue.replace(/[\r\n,]/g, " "),
    plantingRef: data.plantingRef,
    machine,
    human
  });

  // ★ CSV 再生成（列順固定）
  const csvText = Papa.unparse(rows, {
    columns: [
      "harvestDate",
      "shippingDate",
      "worker",
      "field",
      "amount",
      "issue",
      "plantingRef",
      "machine",
      "human"
    ]
  });

  // ★ replace 保存
  await saveLog("harvest", "all", {}, "", csvText, "csv-replace");

  // ★ summaryUpdate
  updateSaveModal("サマリーを更新しています…");
  enqueueSummaryUpdate(data.plantingRef);

  // ★ 完了待ち
  window.addEventListener(
    "summaryQueueEmpty",
    () => {
      completeSaveModal("保存が完了しました");

      // ★ 保存内容のアラート（共通関数）
      showSaveAlert("収穫ログを保存しました", [
        { label: "収穫日", value: data.harvestDate },
        { label: "出荷日", value: data.shippingDate },
        { label: "圃場", value: data.field },
        { label: "収穫量", value: data.amount },
        { label: "作業者", value: data.worker },
        { label: "備考", value: data.issue || "なし" }
      ]);
    },
    { once: true }
  );
}

window.saveHarvest = saveHarvestInner;