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
import { saveTimestampRows } from "/common/timestamp.js?v=1";
import { checkDuplicate } from "../common/duplicate.js";
import { parseCsvText } from "../common/csv.js?v=20260820";
import { todayLocalYmd } from "../common/date-utils.js";

// ★ サマリー自動更新
import { enqueueSummaryUpdate } from "../common/summary.js";
import { setupFieldModalPicker } from "/common/field-modal-picker.js?v=7";

const DEBUG = localStorage.getItem("debugHarvest") === "1";
const HARVEST_PLAN_WINDOW_DAYS = 50;
const log = (...args) => { if (DEBUG) console.log("[harvest]", ...args); };

// ★ 保存モーダル
import {
  showSaveModal,
  updateSaveModal,
  completeSaveModal,
  confirmSaveBeforeSubmit
} from "../common/save-modal.js";



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
// 初期化
// ===============================
export async function initHarvestPage() {
  log("initHarvestPage start");

  createWorkerCheckboxes("workers_box");
  const fields = await createFieldSelector("field_auto", "field_area", "field_manual");
  autoDetectField("field_auto", "field_area", "field_manual");
  setupFieldModalPicker({ fields });

  document.getElementById("field_manual")
    .addEventListener("change", updatePlantingRefOptions);
  document.getElementById("field_auto")
    .addEventListener("change", updatePlantingRefOptions);
  document.getElementById("field_confirm")
    .addEventListener("change", updatePlantingRefOptions);
  document.getElementById("harvestDate")
    .addEventListener("change", updatePlantingRefOptions);

  const today = todayLocalYmd();
  document.getElementById("harvestDate").value = today;
  document.getElementById("shippingDate").value = today;

  log("initHarvestPage done");
}


// ===============================
// planting CSV 読み込み（CloudFront）
// ===============================
async function loadPlantingCSV() {
  if (plantingCache) return plantingCache;

  const url = "../logs/planting/all.csv?ts=" + Date.now();
  const res = await fetch(url);
  const text = await res.text();
  const rows = parseCsvText(text);

  plantingCache = rows;
  return rows;
}


// ===============================
// ★ 定植候補更新
// ===============================
async function updatePlantingRefOptions() {
  log("updatePlantingRefOptions start");

  const field = getFinalField();
  const harvestDate = document.getElementById("harvestDate").value;
  const select = document.getElementById("plantingRef");

  select.innerHTML = "<option value=''>候補を読み込んでいます…</option>";

  if (!field || !harvestDate) {
    log("field or harvestDate missing");
    return;
  }

  const plantingList = await loadPlantingCSV();
  const nf = normalizeFieldName(field);

  const candidates = plantingList.filter(p =>
    normalizeFieldName(p.field || "") === nf
  );

  if (candidates.length === 0) return;

  const eligible = candidates.filter(p => {
    if (!p.plantDate) return false;
    return new Date(p.plantDate) <= new Date(harvestDate);
  });

  const plannedMatches = eligible.filter(p => {
    const plannedMonth = String(p.harvestPlanYM || "").trim();
    if (!/^\d{4}-\d{2}$/.test(plannedMonth)) return false;
    const plannedDate = new Date(`${plannedMonth}-01T00:00:00`);
    const actualDate = new Date(`${harvestDate}T00:00:00`);
    if (Number.isNaN(plannedDate.getTime()) || Number.isNaN(actualDate.getTime())) return false;
    return Math.abs(actualDate.getTime() - plannedDate.getTime()) <= HARVEST_PLAN_WINDOW_DAYS * 86400000;
  });

  const hasPlannedMatches = plannedMatches.length > 0;
  const finalList = hasPlannedMatches ? plannedMatches : eligible;
  const varietySet = new Set(finalList.map(p => String(p.variety || "").trim()).filter(Boolean));
  const canAutoSelect = hasPlannedMatches && varietySet.size === 1;

  finalList.sort((a, b) => {
    if (hasPlannedMatches) {
      const varietyOrder = String(a.variety || "").localeCompare(String(b.variety || ""), "ja");
      if (varietyOrder !== 0) return varietyOrder;
      return String(a.seedRef || "").localeCompare(String(b.seedRef || ""), "ja");
    }
    return new Date(b.plantDate) - new Date(a.plantDate);
  });

  select.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = canAutoSelect
    ? "収穫予定±50日の候補から自動選択"
    : (hasPlannedMatches ? "品種が複数あります。収穫対象を選択" : "予定月±50日に候補なし。収穫対象を選択");
  select.appendChild(placeholder);

  finalList.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.plantingRef;
    opt.textContent = `${p.plantDate} / ${p.variety} / ${Number(p.quantity || 0).toLocaleString()}株`;
    select.appendChild(opt);
  });

  if (canAutoSelect && finalList.length >= 1) {
    select.value = finalList[0].plantingRef;
  }

  log("updatePlantingRefOptions done");
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
  log("saveHarvestInner");

  const data = collectHarvestData();

  if (!data.harvestDate) {
    alert("収穫日を入力してください");
    return;
  }
  if (!data.plantingRef) {
    alert("収穫対象を選択してください");
    return;
  }
  if (!String(data.worker || "").trim()) {
    alert("作業者は必須です");
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

  const confirmed = await confirmSaveBeforeSubmit({
    lines: [
      `収穫日: ${data.harvestDate}`,
      `圃場: ${data.field || "未設定"}`,
      `作業者: ${data.worker}`,
      `数量: ${data.amount || "未入力"}`,
      `定植参照: ${data.plantingRef}`,
      `特記事項: ${String(data.issue || "").trim() || "なし"}`
    ]
  });
  if (!confirmed) return;

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
  await saveLog({
    type: "harvest",
    replaceCsv: csvText,
    fileName: "all.csv",
    summary: { date: data.harvestDate, sourceKey: "harvest", count: 1 }
  });

  await saveTimestampRows([{
    date: data.harvestDate,
    folder: "harvest",
    workType: "収穫",
    field: data.field,
    workers: data.worker,
    machine,
    time: getCurrentTimeText()
  }]).catch(e => {
    console.warn("[harvest] timestamp update failed:", e);
  });

  // ★ summaryUpdate
  updateSaveModal("サマリーを更新しています…");
  enqueueSummaryUpdate(data.plantingRef);

  // ★ 完了待ち
  window.addEventListener(
    "summaryQueueEmpty",
    () => {
      completeSaveModal("保存が完了しました");
    },
    { once: true }
  );
}

window.saveHarvest = saveHarvestInner;

function getCurrentTimeText() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}
