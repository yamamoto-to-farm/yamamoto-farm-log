// ===============================
// import
// ===============================
import { saveLog } from "../common/save/index.js";
import { getMachineParam } from "../common/utils.js";
import { saveTimestampRows } from "/common/timestamp.js?v=1";
import { parseCsvText } from "../common/csv.js?v=20260820";
import { todayLocalYmd } from "../common/date-utils.js";

// ★ サマリー自動更新
import { enqueueSummaryUpdate } from "../common/summary.js";

// ★ 保存モーダル
import {
  showSaveModal,
  updateSaveModal,
  completeSaveModal,
  confirmSaveBeforeSubmit
} from "../common/save-modal.js";

const DEBUG = localStorage.getItem("debugShipping") === "1";
const log = (...args) => { if (DEBUG) console.log("[shipping]", ...args); };

// ===============================
// チェック順管理
// ===============================
let checkedOrder = [];
let unshippedByKey = new Map();


// ===============================
// 初期化
// ===============================
export function initShippingPage() {
  const today = todayLocalYmd();
  document.getElementById("shippingDate").value = today;

  document.getElementById("weights").addEventListener("input", refreshShippingSummary);
  loadUnshipped();
}


// ===============================
// ★ CSV 読み込み（壊れたヘッダー修正版）
// ===============================
async function loadCSV(url) {
  log("loadCSV", url);

  try {
    const res = await fetch(url + "?ts=" + Date.now());
    const text = await res.text();
    return parseCsvText(text);

  } catch (e) {
    console.error("[loadCSV] 例外:", e);
    return [];
  }
}


// ===============================
// 未計量の収穫
// ===============================
async function loadUnshipped() {
  const harvest = await loadCSV("../logs/harvest/all.csv");
  const weight = await loadCSV("../logs/weight/all.csv");

  const harvestMap = {};
  harvest.forEach(row => {
    const key = row.shippingDate + "_" + row.plantingRef;
    const bins = Number(row.amount) || 0;
    const field = row.field;

    if (!harvestMap[key]) harvestMap[key] = { field, bins: 0 };
    harvestMap[key].bins += bins;
  });

  const weightMap = {};
  weight.forEach(row => {
    const key = row.shippingDate + "_" + row.plantingRef;
    const bins = Number(row.bins) || 0;
    weightMap[key] = (weightMap[key] || 0) + bins;
  });

  const unshipped = [];
  Object.keys(harvestMap).forEach(key => {
    const harvested = harvestMap[key].bins;
    const shipped = weightMap[key] || 0;
    const remain = harvested - shipped;

    if (remain > 0) {
      unshipped.push({
        key,
        shippingDate: key.split("_")[0],
        plantingRef: key.split("_")[1],
        field: harvestMap[key].field,
        remainBins: remain
      });
    }
  });

  const area = document.getElementById("unshippedArea");
  area.innerHTML = "";
  unshippedByKey = new Map(unshipped.map(item => [item.key, item]));
  checkedOrder = checkedOrder.filter(key => unshippedByKey.has(key));

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
  refreshShippingSummary();
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
  refreshShippingSummary();
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
  const entries = raw
    .split(/[\s,]+/)
    .map(v => v.trim())
    .filter(Boolean);
  const values = [];
  const invalid = [];

  entries.forEach(entry => {
    const value = Number(entry);
    if (!Number.isFinite(value) || value <= 0) {
      invalid.push(entry);
    } else {
      values.push(value);
    }
  });

  return { values, invalid };
}

function formatShippingNumber(value) {
  return Number(value.toFixed(2)).toLocaleString("ja-JP", { maximumFractionDigits: 2 });
}

function getSelectedTargets() {
  return checkedOrder
    .map(key => unshippedByKey.get(key))
    .filter(Boolean)
    .map(item => ({
      ...item,
      originalRemain: item.remainBins,
      remainBins: item.remainBins,
      assignedBins: 0,
      totalWeight: 0
    }));
}

function getShippingInputSummary() {
  const targets = getSelectedTargets();
  const parsedWeights = parseWeights(document.getElementById("weights").value);
  const selectedBins = targets.reduce((sum, target) => sum + target.originalRemain, 0);
  const requiredWeights = Math.ceil(selectedBins / 2);
  const totalWeight = parsedWeights.values.reduce((sum, weight) => sum + weight, 0);

  allocateWeights(targets, parsedWeights.values);

  return {
    targets,
    weights: parsedWeights.values,
    invalidWeights: parsedWeights.invalid,
    selectedBins,
    requiredWeights,
    totalWeight,
    allocatedBins: targets.reduce((sum, target) => sum + target.assignedBins, 0),
    allocatedWeight: targets.reduce((sum, target) => sum + target.totalWeight, 0),
    unallocatedBins: targets.reduce((sum, target) => sum + target.remainBins, 0)
  };
}

function refreshShippingSummary() {
  const summary = document.getElementById("shippingSummary");
  const preview = document.getElementById("allocationPreview");
  const saveButton = document.getElementById("saveShippingButton");
  if (!summary || !preview || !saveButton) return;

  const input = getShippingInputSummary();
  const tooManyWeights = input.weights.length > input.requiredWeights;
  const canSave = input.targets.length > 0 &&
    input.weights.length > 0 &&
    input.invalidWeights.length === 0 &&
    !tooManyWeights;

  saveButton.disabled = !canSave;

  if (input.targets.length === 0) {
    summary.textContent = "対象を選択すると、基数と重量の割当内容を表示します。";
  } else {
    const message = [
      `選択：${input.targets.length}件 / ${formatShippingNumber(input.selectedBins)}基`,
      `重量：${input.weights.length}件 / ${formatShippingNumber(input.totalWeight)}kg`,
      `必要な重量入力数：${input.requiredWeights}件（1件あたり最大2基分）`,
      `今回の計量：${formatShippingNumber(input.allocatedBins)}基 / ${formatShippingNumber(input.allocatedWeight)}kg`
    ];

    if (input.invalidWeights.length) {
      message.push(`入力エラー：${input.invalidWeights.join("、")} は0より大きい数値で入力してください。`);
    } else if (tooManyWeights) {
      message.push(`重量入力が${input.weights.length - input.requiredWeights}件多いため、入力を見直してください。`);
    } else if (input.unallocatedBins > 0) {
      message.push(`未計量：${formatShippingNumber(input.unallocatedBins)}基（今回は出荷記録に含まれません）`);
    }
    summary.textContent = message.join("\n");
  }

  preview.replaceChildren();
  if (input.targets.length) {
    const heading = document.createElement("strong");
    heading.textContent = "重量の割当先（選択順）";
    preview.appendChild(heading);

    const list = document.createElement("ul");
    input.targets.forEach(target => {
      const item = document.createElement("li");
      item.textContent = `${target.field} / ${target.plantingRef}：${formatShippingNumber(target.assignedBins)}基・${formatShippingNumber(target.totalWeight)}kg`;
      list.appendChild(item);
    });
    preview.appendChild(list);
  }
}


// ===============================
// 重量割当
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
      t.assignedBins += binsForThis;
      t.remainBins -= binsForThis;

      remainBinsInW -= binsForThis;
    }
  }
}


// ===============================
// 重複チェック
// ===============================
async function checkShippingDuplicate(shippingDate, targets) {
  const weight = await loadCSV("../logs/weight/all.csv");

  for (let t of targets) {
    const dup = weight.find(w =>
      w.shippingDate === shippingDate &&
      w.plantingRef === t.plantingRef &&
      Number(w.bins) === t.originalRemain
    );

    if (dup) {
      return {
        ok: false,
        message: `${t.plantingRef} は既に同じ基数で出荷済みです`
      };
    }
  }

  return { ok: true };
}


// ===============================
// ★ 保存処理（replace 方式 + human 正規化）
// ===============================
async function saveShipping() {
  const shippingDate = document.getElementById("shippingDate").value;
  const notes = document.getElementById("notes").value;
  const machine = getMachineParam();

  // ★ human を完全正規化（クォート除去）
  const rawHuman = window.currentHuman || "";
  const cleanHuman = rawHuman.replace(/"/g, "").trim();

  if (checkedOrder.length === 0) {
    alert("対象を選択してください");
    return;
  }

  const input = getShippingInputSummary();
  if (input.invalidWeights.length > 0) {
    alert(`重量に無効な入力があります: ${input.invalidWeights.join("、")}（0より大きい数値を入力してください）`);
    return;
  }
  const weightList = input.weights;
  if (weightList.length === 0) {
    alert("重量を入力してください");
    return;
  }
  if (weightList.length > input.requiredWeights) {
    alert(`重量入力が多すぎます。選択した基数に必要な重量入力数は${input.requiredWeights}件です。`);
    return;
  }
  const totalWeight = weightList.reduce((sum, weight) => sum + weight, 0);

  const confirmed = await confirmSaveBeforeSubmit({
    lines: [
      `出荷日: ${shippingDate}`,
      `対象件数: ${input.targets.length}件`,
      `選択基数: ${formatShippingNumber(input.selectedBins)}基`,
      `重量入力数: ${weightList.length}件`,
      `重量合計: ${formatShippingNumber(totalWeight)}kg`,
      `今回の計量: ${formatShippingNumber(input.allocatedBins)}基 / ${formatShippingNumber(input.allocatedWeight)}kg`,
      ...input.targets.map(t =>
        `割当 ${t.field} / ${t.plantingRef}: ${formatShippingNumber(t.assignedBins)}基 / ${formatShippingNumber(t.totalWeight)}kg`
      ),
      ...(input.unallocatedBins > 0
        ? [`未計量: ${formatShippingNumber(input.unallocatedBins)}基（今回は出荷記録に含まれません）`]
        : []),
      `機械: ${machine || "未設定"}`,
      `備考: ${String(notes || "").trim() || "なし"}`
    ]
  });
  if (!confirmed) return;

  // ★ 保存モーダル（保存中…）
  showSaveModal("保存中です…");

  const harvest = await loadCSV("../logs/harvest/all.csv");
  const weight = await loadCSV("../logs/weight/all.csv");

  const harvestMap = {};
  harvest.forEach(row => {
    const key = row.shippingDate + "_" + row.plantingRef;
    const bins = Number(row.amount) || 0;
    const field = row.field;

    if (!harvestMap[key]) harvestMap[key] = { field, bins: 0 };
    harvestMap[key].bins += bins;
  });

  const weightMap = {};
  weight.forEach(row => {
    const key = row.shippingDate + "_" + row.plantingRef;
    const bins = Number(row.bins) || 0;
    weightMap[key] = (weightMap[key] || 0) + bins;
  });

  const targets = checkedOrder.map(key => {
    const harvested = harvestMap[key].bins;
    const shipped = weightMap[key] || 0;
    const remain = harvested - shipped;

    return {
      key,
      plantingRef: key.split("_")[1],
      field: harvestMap[key].field,
      originalRemain: remain,
      remainBins: remain,
      assignedBins: 0,
      totalWeight: 0
    };
  });

  const dup = await checkShippingDuplicate(shippingDate, targets);
  if (!dup.ok) {
    alert(dup.message);
    return;
  }

  allocateWeights(targets, weightList);

  // ===============================
  // ★ weight/all.csv を replace 保存
  // ===============================
  let rows = [];
  if (weight.length > 0) rows = weight;

  targets.forEach(t => {
    if (t.assignedBins <= 0) return;

    const shippedBins = t.originalRemain - t.remainBins;

    rows.push({
      shippingDate,
      field: t.field,
      bins: shippedBins,
      totalWeight: t.totalWeight,
      notes: notes.replace(/[\r\n,]/g, " "),
      plantingRef: t.plantingRef,
      machine,
      human: cleanHuman
    });
  });

  const csvText = Papa.unparse(rows, {
    columns: [
      "shippingDate",
      "field",
      "bins",
      "totalWeight",
      "notes",
      "plantingRef",
      "machine",
      "human"
    ]
  });

  await saveLog({
    type: "weight",
    replaceCsv: csvText,
    fileName: "all.csv"
  });

  await saveTimestampRows(rows.map(r => ({
    date: r.shippingDate,
    folder: "weight",
    workType: "出荷",
    field: r.field,
    workers: r.human,
    machine: r.machine,
    time: getCurrentTimeText()
  }))).catch(e => {
    console.warn("[shipping] timestamp update failed:", e);
  });

  // ★ サマリー更新
  targets
    .filter(t => t.assignedBins > 0)
    .forEach(t => enqueueSummaryUpdate(t.plantingRef));

  // ★ モーダルを「サマリー更新中…」に
  updateSaveModal("サマリー更新中…");

  // ===============================
  // ★ summaryQueueEmpty → 完了モーダル + alert-utils
  // ===============================
  window.addEventListener(
    "summaryQueueEmpty",
    () => {
      completeSaveModal("保存が完了しました");
    },
    { once: true }
  );
}

function getCurrentTimeText() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

window.saveShipping = saveShipping;
