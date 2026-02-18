// ===============================
// import
// ===============================
import { saveLog } from "../common/save/index.js";
import { getMachineParam } from "../common/utils.js";


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
    `;

    area.appendChild(div);
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
    let remainBinsInW = 2.0;   // 1回の計量は最大2基ぶん
    let remainWeight  = W;

    for (let t of targets) {
      if (remainBinsInW <= 0) break;
      if (t.remainBins <= 0) continue;

      const binsForThis = Math.min(t.remainBins, remainBinsInW);
      const weightForThis = W * (binsForThis / 2.0);

      t.totalWeight += weightForThis;
      t.remainBins  -= binsForThis;

      remainBinsInW -= binsForThis;
      remainWeight  -= weightForThis;
    }
  }
}


// ===============================
// 保存処理
// ===============================
async function saveShipping() {
  const shippingDate = document.getElementById("shippingDate").value;
  const notes        = document.getElementById("notes").value;
  const machine      = getMachineParam();
  const human        = window.currentHuman || "";

  const selected = [...document.querySelectorAll(".refCheck:checked")].map(c => c.value);
  if (selected.length === 0) {
    alert("対象を選択してください");
    return;
  }

  if (selected.length === 1) {
    if (!confirm("1つの圃場しか選択されていません。このまま記録しますか？")) return;
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

  // チェック順（index.html 側で管理）
  const targets = selected.map(key => {
    const harvested = harvestMap[key].bins;
    const shipped   = weightMap[key] || 0;
    const remain    = harvested - shipped;
    return {
      key,
      plantingRef: key.split("_")[1],
      field: harvestMap[key].field,
      remainBins: remain,
      totalWeight: 0
    };
  });

  // 必要回数チェック
  const requiredCount = targets
    .map(t => calcRequiredCount(t.remainBins))
    .reduce((a, b) => a + b, 0);

  if (weightList.length < requiredCount) {
    if (!confirm(`必要回数は ${requiredCount} 回ですが、入力は ${weightList.length} 回です。このまま続行しますか？`)) {
      return;
    }
  } else if (weightList.length > requiredCount) {
    alert(`必要回数は ${requiredCount} 回です。余分な入力は無視されます。`);
  }

  // 割当実行
  allocateWeights(targets, weightList);

  // 圃場ごとに1行だけ保存
  for (let t of targets) {
    const csvLine = [
      shippingDate,
      t.field,
      t.remainBins, // 保存時点の残り基数（分析で使うなら元値も可）
      t.totalWeight,
      notes.replace(/[\r\n,]/g, " "),
      t.plantingRef,
      machine,
      human
    ].join(",");

    await saveLog("shipping", shippingDate.replace(/-/g, ""), {}, csvLine);
  }

  alert("保存しました");
}

window.saveShipping = saveShipping;