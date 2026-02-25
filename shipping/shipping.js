// ===============================
// import
// ===============================
import { saveLog } from "../common/save/index.js";
import { getMachineParam } from "../common/utils.js";

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
let checkedOrder = [];   // 例: ["2025-02-10_ABC123", "2025-02-10_DEF456"]


// ===============================
// 初期化（認証後に index.html から呼ばれる）
// ===============================
export function initShippingPage() {
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById("shippingDate").value = today;

  loadUnshipped();
}


// ===============================
// ★ CSV 読み込み（ヘッダー対応版 + デバッグ）
// ===============================
async function loadCSV(url) {
  console.log("[loadCSV] 読み込み開始:", url);

  try {
    const res = await fetch(url + "?ts=" + Date.now());
    const text = await res.text();

    console.log("[loadCSV] 生テキスト:", text);

    if (!text.trim()) {
      console.log("[loadCSV] 空ファイル → []");
      return [];
    }

    const lines = text.trim().split("\n");
    const headers = lines[0].split(",");

    const rows = lines.slice(1).map(line => {
      const cols = line.split(",");
      const obj = {};
      headers.forEach((h, i) => obj[h] = cols[i] || "");
      return obj;
    });

    console.log("[loadCSV] パース結果:", rows);
    return rows;

  } catch (e) {
    console.error("[loadCSV] 例外:", e);
    return [];
  }
}


// ===============================
// 未計量の収穫（shippingDate × plantingRef）
// ===============================
async function loadUnshipped() {
  console.log("=== loadUnshipped 開始 ===");

  const harvest = await loadCSV("../logs/harvest/all.csv");
  const weight  = await loadCSV("../logs/weight/all.csv");

  console.log("[loadUnshipped] harvest:", harvest);
  console.log("[loadUnshipped] weight:", weight);

  const harvestMap = {};
  harvest.forEach(row => {
    const shippingDate = row.shippingDate;
    const plantingRef  = row.plantingRef;
    const field        = row.field;
    const bins         = Number(row.bins) || 0;

    const key = shippingDate + "_" + plantingRef;

    if (!harvestMap[key]) harvestMap[key] = { field, bins: 0 };
    harvestMap[key].bins += bins;
  });

  console.log("[loadUnshipped] harvestMap:", harvestMap);

  const weightMap = {};
  weight.forEach(row => {
    const shippingDate = row.shippingDate;
    const plantingRef  = row.plantingRef;
    const bins         = Number(row.bins) || 0;

    const key = shippingDate + "_" + plantingRef;

    weightMap[key] = (weightMap[key] || 0) + bins;
  });

  console.log("[loadUnshipped] weightMap:", weightMap);

  const unshipped = [];
  Object.keys(harvestMap).forEach(key => {
    const harvested = harvestMap[key].bins;
    const shipped   = weightMap[key] || 0;
    const remain    = harvested - shipped;

    console.log(`[loadUnshipped] key=${key} harvested=${harvested} shipped=${shipped} remain=${remain}`);

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

  console.log("[loadUnshipped] 未計量候補:", unshipped);

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

  console.log("=== loadUnshipped 終了 ===");
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
// ★ shipping 専用の重複チェック
// ===============================
async function checkShippingDuplicate(shippingDate, targets) {
  const weight = await loadCSV("../logs/weight/all.csv");

  for (let t of targets) {
    const dup = weight.find(w =>
      w.shippingDate === shippingDate &&
      w.plantingRef  === t.plantingRef &&
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
// ★ 保存処理（ヘッダー対応版）
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
  harvest.forEach(row => {
    const key  = row.shippingDate + "_" + row.plantingRef;
    const field = row.field;
    const bins  = Number(row.bins) || 0;

    if (!harvestMap[key]) harvestMap[key] = { field, bins: 0 };
    harvestMap[key].bins += bins;
  });

  const weightMap = {};
  weight.forEach(row => {
    const key  = row.shippingDate + "_" + row.plantingRef;
    const bins = Number(row.bins) || 0;
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

  const dup = await checkShippingDuplicate(shippingDate, targets);
  if (!dup.ok) {
    alert(dup.message);
    return;
  }

  allocateWeights(targets, weightList);

  const header =
    "shippingDate,field,bins,totalWeight,notes,plantingRef,machine,human\n";

  let csvLines = header;

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