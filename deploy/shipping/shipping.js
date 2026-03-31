// ===============================
// import
// ===============================
import { saveLog } from "../common/save/index.js";
import { getMachineParam } from "../common/utils.js";

// ★ サマリー自動更新
import { enqueueSummaryUpdate } from "../common/summary.js";

// ★ alert-utils（共通アラート）
import { showSaveAlert } from "../common/alert-utils.js";

// ★ 保存モーダル
import {
  showSaveModal,
  updateSaveModal,
  completeSaveModal
} from "../common/save-modal.js";


// ===============================
// ★ デバッグ：shipping.js が読み込まれたか確認
// ===============================
console.log("=== shipping.js loaded ===");

try {
  console.log("import saveLog:", saveLog);
} catch (e) {
  console.error("import saveLog 失敗:", e);
}

// ===============================
// チェック順管理
// ===============================
let checkedOrder = [];


// ===============================
// 初期化
// ===============================
export function initShippingPage() {
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById("shippingDate").value = today;

  loadUnshipped();
}


// ===============================
// ★ CSV 読み込み（壊れたヘッダー修正版）
// ===============================
async function loadCSV(url) {
  console.log("[loadCSV] 読み込み開始:", url);

  try {
    const res = await fetch(url + "?ts=" + Date.now());
    const text = await res.text();

    if (!text.trim()) return [];

    const lines = text.trim().split("\n");

    // ★ ヘッダーのダブルクォート・空白を除去
    const headers = lines[0]
      .split(",")
      .map(h => h.replace(/["\s]/g, ""));

    const rows = lines.slice(1).map(line => {
      const cols = line.split(",");
      const obj = {};
      headers.forEach((h, i) => {
        let v = cols[i] || "";
        // ★ 値のダブルクォートも除去
        v = v.replace(/^"+|"+$/g, "").trim();
        obj[h] = v;
      });
      return obj;
    });

    return rows;

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

  const raw = document.getElementById("weights").value;
  const weightList = parseWeights(raw);
  if (weightList.length === 0) {
    alert("重量を入力してください");
    return;
  }

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
    const shippedBins = t.originalRemain - t.remainBins;

    rows.push({
      shippingDate,
      field: t.field,
      bins: shippedBins,
      totalWeight: t.totalWeight,
      notes: notes.replace(/[\r\n,]/g, " "),
      plantingRef: t.plantingRef,
      machine,
      human: cleanHuman   // ← ★ human を完全正規化して保存
    });
  });

  // ★ ヘッダーを強制指定（壊れたヘッダーを完全修正）
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

  await saveLog("weight", "all", {}, "", csvText, "csv-replace");

  targets.forEach(t => enqueueSummaryUpdate(t.plantingRef));

let msg = "出荷ログを保存しました\n\n";

targets.forEach(t => {
  const shippedBins = t.originalRemain - t.remainBins;

  msg +=
    `定植: ${t.plantingRef}\n` +
    `出荷日: ${shippingDate}\n` +
    `圃場: ${t.field}\n` +
    `出荷基数: ${shippedBins} 基\n` +
    `重量: ${t.totalWeight.toFixed(1)} kg\n` +
    `作業者: ${cleanHuman}\n` +
    `備考: ${notes || "なし"}\n\n`;
});

alert(msg);

  console.log("=== saveShipping: replace 保存完了 ===");
  setTimeout(() => location.reload(), 300);

}

window.saveShipping = saveShipping;