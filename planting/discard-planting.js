// ===============================
// モジュール変数
// ===============================
let plantingRef = null;
let plantingRow = null;

// ===============================
// 初期化（plantingRef 取得 → 定植データ読み込み）
// ===============================
export async function initDiscardPage(readText, loadCSV, formatDate) {
  const params = new URLSearchParams(location.search);
  plantingRef = params.get("ref");

  if (!plantingRef) {
    alert("plantingRef が指定されていません");
    return;
  }

  await loadPlanting(loadCSV);
  setupAutoCalc();
}

// ===============================
// 定植データ読み込み
// ===============================
async function loadPlanting(loadCSV) {
  const rows = await loadCSV("logs/planting/all.csv").catch(() => []);

  plantingRow = rows.find(r => r.plantingRef === plantingRef);

  if (!plantingRow) {
    alert("該当する定植記録が見つかりません");
    return;
  }

  document.getElementById("plantDate").textContent = plantingRow.plantDate;
  document.getElementById("field").textContent = plantingRow.field;
  document.getElementById("variety").textContent = plantingRow.variety;
  document.getElementById("quantity").textContent = plantingRow.quantity;
}

// ===============================
// 自動計算セットアップ
// ===============================
function setupAutoCalc() {
  const calc = () => {
    const total = Number(document.getElementById("totalBeds").value);
    const tilled = Number(document.getElementById("tilledBeds").value);

    if (!total || total <= 0) return;

    const rate = tilled / total;
    const discardRate = Math.min(Math.max(rate, 0), 1);

    const plantingQty = Number(plantingRow?.quantity ?? 0);
    const discardQty = Math.ceil(plantingQty * discardRate);

    document.getElementById("discardRate").textContent = Math.round(discardRate * 100);
    document.getElementById("discardQuantity").textContent = discardQty;
  };

  document.getElementById("totalBeds").addEventListener("input", calc);
  document.getElementById("tilledBeds").addEventListener("input", calc);
}

// ===============================
// 保存処理
// ===============================
export async function saveDiscard(readText, writeText, appendCSV) {
  const discardDate = document.getElementById("discardDate").value;
  const notes = document.getElementById("notes").value;
  const discardQty = Number(document.getElementById("discardQuantity").textContent);

  if (!discardDate) {
    alert("破棄日を入力してください");
    return;
  }

  if (!discardQty || discardQty < 0) {
    alert("破棄株数が計算できていません");
    return;
  }

  const line = {
    discardDate,
    plantingRef,
    discardQuantity: discardQty,
    notes,
    machine: window.currentMachine ?? "",
    human: window.currentHuman ?? ""
  };

  await appendCSV("logs/discard-planting/all.csv", line);

  alert("破棄ログを保存しました");
  location.href = "../index.html";
}