// ===============================
// import
// ===============================
import { showPinGate } from "../common/ui.js";
import { saveLog } from "../common/save/index.js";
import { getMachineParam } from "../common/utils.js";


// ===============================
// PIN 認証
// ===============================
window.addEventListener("DOMContentLoaded", () => {
  showPinGate("pin-area", () => {
    document.getElementById("form-area").style.display = "block";

    // 日付初期値
    const today = new Date().toISOString().slice(0, 10);
    document.getElementById("shippingDate").value = today;
  });
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
      plantingRef: cols[6],
      machine: cols[7],
      human: cols[8]
    };
  });
}


// ===============================
// 未計量の収穫ログを読み込む
// ===============================
window.loadShipping = async function () {
  const harvestList = await loadHarvestCSV();

  // shippingDate が空 → 未計量
  const unshipped = harvestList.filter(h => !h.shippingDate);

  const area = document.getElementById("resultArea");
  area.innerHTML = "";

  if (unshipped.length === 0) {
    area.textContent = "未計量の収穫ログはありません。";
    return;
  }

  unshipped.forEach(h => {
    const div = document.createElement("div");
    div.style.padding = "8px";
    div.style.marginBottom = "8px";
    div.style.background = "#fff";
    div.style.border = "1px solid #ccc";

    div.innerHTML = `
      <div>収穫日：${h.harvestDate}</div>
      <div>圃場：${h.field}</div>
      <div>収穫基数：${h.bins}</div>
      <div>plantingRef：${h.plantingRef}</div>
    `;

    area.appendChild(div);
  });
};


// ===============================
// 入力データ収集
// ===============================
function collectShippingData() {
  return {
    shippingDate: document.getElementById("shippingDate").value,
    weight: document.getElementById("weight").value,
    notes: document.getElementById("notes").value
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

  // shipping は plantingRef を持たない（harvest 側が持っている）
  const csvLine = [
    data.shippingDate,
    "",          // field（shipping では不要）
    data.weight,
    data.notes.replace(/[\r\n,]/g, " "),
    "",          // plantingRef（shipping では不要）
    machine,
    human
  ].join(",");

  await saveLog("shipping", dateStr, data, csvLine);

  alert("GitHubに保存しました");
}

window.saveShipping = saveShippingInner;