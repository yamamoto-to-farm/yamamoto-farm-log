// ===============================
// モジュール変数
// ===============================
let plantingRef = null;
let plantingRow = null;

// ===============================
// 必要なモジュール
// ===============================
import { loadCSV } from "/common/csv.js";
import { saveLog } from "/common/save/index.js";
import {
  showSaveModal,
  updateSaveModal,
  completeSaveModal
} from "/common/save-modal.js";
import { enqueueSummaryUpdate } from "/common/summary.js";

// ===============================
// ▼ CSV のキー名を正規化（plantingList.js と統一）
// ===============================
function normalizeKeys(rows) {
  return rows.map(row => {
    const fixed = {};
    Object.keys(row).forEach(k => fixed[k.trim()] = row[k]);
    return fixed;
  });
}

// ===============================
// 初期化（plantingRef 取得 → 定植データ読み込み）
// ===============================
export async function initDiscardPage() {
  const params = new URLSearchParams(location.search);
  plantingRef = params.get("ref");

  console.log("🔥 discard page loaded");
  console.log("受け取った ref =", plantingRef);

  if (!plantingRef) {
    alert("plantingRef が指定されていません");
    return;
  }

  await loadPlanting();
  setupAutoCalc();
}

// ===============================
// 定植データ読み込み
// ===============================
async function loadPlanting() {

  // ★ 絶対パスに修正（これが最重要）
  const rowsRaw = await loadCSV("/logs/planting/all.csv").catch(() => []);

  // ★ キー正規化（plantingRef\r 問題を完全解決）
  const rows = normalizeKeys(rowsRaw);

  console.log("読み込んだ plantingRows =", rows);
  console.log("plantingRows[0] のキー =", Object.keys(rows[0] || {}));

  // ★ plantingRef で検索
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
// 保存処理（planting.js と完全統一）
// ===============================
export async function saveDiscard() {
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

  const notesClean = notes.replace(/[\r\n,]/g, " ");
  const dateStr = discardDate.replace(/-/g, "");

  const confirmMsg =
    `以下の内容で保存します。\n\n` +
    `破棄日: ${discardDate}\n` +
    `定植日: ${plantingRow.plantDate}\n` +
    `圃場: ${plantingRow.field}\n` +
    `品種: ${plantingRow.variety}\n` +
    `破棄株数: ${discardQty}\n` +
    `備考: ${notesClean || "なし"}\n\n` +
    `よろしいですか？`;

  if (!confirm(confirmMsg)) return;

  showSaveModal("保存しています…");

  // ★ discard-planting/all.csv を replace 保存
  const url = "/logs/discard-planting/all.csv?ts=" + Date.now();
  const res = await fetch(url);
  const text = await res.text();

  let rows = [];
  if (text.trim()) {
    rows = Papa.parse(text, {
      header: true,
      skipEmptyLines: true
    }).data;
  }

  rows.push({
    discardDate,
    plantingRef,
    discardQty,
    notes: notesClean,
    machine: window.currentMachine ?? "",
    human: window.currentHuman ?? ""
  });

  const csvText = Papa.unparse(rows);

  await saveLog("discard-planting", "all", {}, "", csvText, "csv-replace");

  updateSaveModal("サマリーを更新しています…");
  enqueueSummaryUpdate(plantingRef);

  window.addEventListener(
    "summaryQueueEmpty",
    () => {
      completeSaveModal("保存が完了しました");

      alert(
        `破棄ログを保存しました\n\n` +
          `破棄日: ${discardDate}\n` +
          `定植日: ${plantingRow.plantDate}\n` +
          `圃場: ${plantingRow.field}\n` +
          `品種: ${plantingRow.variety}\n` +
          `破棄株数: ${discardQty}\n` +
          `備考: ${notesClean || "なし"}`
      );

      setTimeout(() => (location.href = "../index.html"), 500);
    },
    { once: true }
  );
}
