// ===============================
// import（必ずファイル先頭）
// ===============================
import {
  createWorkerCheckboxes,
  createFieldSelector,
  autoDetectField,
  getSelectedWorkers
} from "../common/ui.js";

import { saveLog } from "../common/save/index.js";
import { getMachineParam } from "../common/utils.js";
import { checkDuplicate } from "../common/duplicate.js";
import { loadCSV } from "../common/csv.js";
import { showSaveModal, updateSaveModal, completeSaveModal } from "../common/save-modal.js";
import { enqueueSummaryUpdate } from "../common/summary.js";

let VARIETY_LIST = [];
let GLOBAL_SEED_ROWS = null;   // ★ seed/all.csv を1回だけ読み込むキャッシュ


// ===============================
// 初期化
// ===============================
export async function initPlantingPage() {
  createWorkerCheckboxes("workers_box");

  await createFieldSelector("field_auto", "field_area", "field_manual");
  autoDetectField("field_auto", "field_area", "field_manual");

  // ★ seed/all.csv を1回だけ読み込む（403対策）
  GLOBAL_SEED_ROWS = await loadCSV("logs/seed/all.csv");

  await setupVarietySelector();
  setupInputModeSwitch();
  setupTrayAutoCalc();
}


// ===============================
// 品種プルダウン
// ===============================
async function setupVarietySelector() {
  const res = await fetch("../data/varieties.json");
  VARIETY_LIST = await res.json();

  const typeSel = document.getElementById("varietyType");
  const nameSel = document.getElementById("variety");

  const types = [...new Set(VARIETY_LIST.map(v => v.type))];
  types.forEach(t => {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = t;
    typeSel.appendChild(opt);
  });

  typeSel.addEventListener("change", () => {
    const selectedType = typeSel.value;
    nameSel.innerHTML = "<option value=''>品名を選択</option>";

    if (!selectedType) return;

    const filtered = VARIETY_LIST.filter(v => v.type === selectedType);

    filtered.forEach(v => {
      const opt = document.createElement("option");
      opt.value = v.name;
      opt.textContent = v.name;
      nameSel.appendChild(opt);
    });
  });

  nameSel.addEventListener("change", updateSeedRefSelector);
}


// ===============================
// seedRef プルダウン更新（播種枚数・トレイ種別も表示）
// ===============================
async function updateSeedRefSelector() {
  const variety = document.getElementById("variety").value;
  const sel = document.getElementById("seedRef");

  const remainSpan = document.getElementById("remainingCount");
  const trayCountSpan = document.getElementById("seedTrayCount");
  const trayTypeSpan = document.getElementById("seedTrayType");

  // 初期化
  sel.innerHTML = "<option value=''>選択してください</option>";
  remainSpan.textContent = "-";
  trayCountSpan.textContent = "-";
  trayTypeSpan.textContent = "-";

  if (!variety) return;

  // ★ seedRows はキャッシュ（403対策）
  const seedRows = GLOBAL_SEED_ROWS;

  // 最新の残数計算のため毎回読み込む
  const plantingRows = await loadCSV("logs/planting/all.csv").catch(() => []);
  const nurseryRows = await loadCSV("logs/nursery/all.csv").catch(() => []);

  // 品種一致の seedRef を抽出
  const list = seedRows.filter(r => r.varietyName === variety);

  // プルダウン生成
  for (const r of list) {
    const seedRef = r.seedRef;
    const seedCount = Number(r.seedCount);

    const planted = plantingRows
      .filter(p => p.seedRef === seedRef)
      .reduce((sum, p) => sum + Number(p.quantity || 0), 0);

    const discarded = nurseryRows
      .filter(n => n.seedRef === seedRef)
      .reduce((sum, n) => sum + Number(n.discard || 0), 0);

    const remaining = seedCount - planted - discarded;

    if (remaining > 0) {
      const opt = document.createElement("option");
      opt.value = seedRef;
      opt.textContent = `${seedRef}（残 ${remaining} 株）`;
      sel.appendChild(opt);
    }
  }

  // ★ 既存の change イベントを一旦削除（イベント重複防止）
  const newSel = sel.cloneNode(true);
  sel.parentNode.replaceChild(newSel, sel);

  // ★ seedRef 選択時の詳細表示（イベントは1回だけ）
  newSel.addEventListener("change", async () => {
    const seedRef = newSel.value;

    if (!seedRef) {
      remainSpan.textContent = "-";
      trayCountSpan.textContent = "-";
      trayTypeSpan.textContent = "-";
      return;
    }

    const seedRow = seedRows.find(r => r.seedRef === seedRef);
    if (!seedRow) {
      remainSpan.textContent = "-";
      trayCountSpan.textContent = "-";
      trayTypeSpan.textContent = "-";
      return;
    }

    // 最新の残数を再計算
    const plantingRows2 = await loadCSV("logs/planting/all.csv").catch(() => []);
    const nurseryRows2 = await loadCSV("logs/nursery/all.csv").catch(() => []);

    const seedCount = Number(seedRow.seedCount);

    const planted = plantingRows2
      .filter(p => p.seedRef === seedRef)
      .reduce((sum, p) => sum + Number(p.quantity || 0), 0);

    const discarded = nurseryRows2
      .filter(n => n.seedRef === seedRef)
      .reduce((sum, n) => sum + Number(n.discard || 0), 0);

    const remaining = seedCount - planted - discarded;

    // ★ 表示更新
    remainSpan.textContent = remaining;
    trayCountSpan.textContent = seedRow.trayCount || "-";
    trayTypeSpan.textContent = seedRow.trayType || "-";
  });
}


// ===============================
// 株数 / 枚数 切り替え
// ===============================
function setupInputModeSwitch() {
  const radios = document.querySelectorAll("input[name='mode']");
  radios.forEach(r => {
    r.addEventListener("change", () => {
      const mode = document.querySelector("input[name='mode']:checked").value;
      document.getElementById("stock-input").style.display = mode === "stock" ? "block" : "none";
      document.getElementById("tray-input").style.display = mode === "tray" ? "block" : "none";
    });
  });
}


// ===============================
// 枚数 → 株数 自動計算
// ===============================
function setupTrayAutoCalc() {
  const update = () => {
    const count = parseFloat(document.getElementById("trayCount").value || 0);
    const type = Number(document.querySelector("input[name='trayType']:checked").value);

    if (!isNaN(count)) {
      const stock = count * type;
      document.getElementById("calcStock").textContent = stock;
    } else {
      document.getElementById("calcStock").textContent = 0;
    }
  };

  document.getElementById("trayCount").addEventListener("input", update);
  document.querySelectorAll("input[name='trayType']").forEach(r => r.addEventListener("change", update));
}


// ===============================
// 圃場の最終決定
// ===============================
function getFinalField() {
  const auto = document.getElementById("field_auto").value;
  const manual = document.getElementById("field_manual").value;
  const confirmed = document.getElementById("field_confirm").checked;

  if (confirmed) return auto;
  if (manual) return manual;
  return auto;
}


// ===============================
// 収穫予定年月の自動計算
// ===============================
function calcHarvestPlanYM(plantDate, harvestMonth) {
  const d = new Date(plantDate);
  let year = d.getFullYear();

  if (harvestMonth <= d.getMonth() + 1) {
    year += 1;
  }

  return `${year}-${String(harvestMonth).padStart(2, "0")}`;
}


// ===============================
// 入力データ収集
// ===============================
function collectPlantingData() {
  const mode = document.querySelector("input[name='mode']:checked").value;
  const trayType = Number(document.querySelector("input[name='trayType']:checked").value);

  let quantity = 0;
  let trayCount = null;

  if (mode === "stock") {
    quantity = Number(document.getElementById("stockCount").value);
  } else {
    trayCount = parseFloat(document.getElementById("trayCount").value);
    quantity = trayCount * trayType;
  }

  const varietyName = document.getElementById("variety").value;
  const variety = VARIETY_LIST.find(v => v.name === varietyName);

  const harvestPlanYM = variety
    ? calcHarvestPlanYM(
      document.getElementById("plantDate").value,
      variety.harvestMonth
    )
    : "";

  return {
    plantDate: document.getElementById("plantDate").value,
    worker: getSelectedWorkers("workers_box", "temp_workers"),
    field: getFinalField(),

    variety: varietyName,
    seedRef: document.getElementById("seedRef").value,

    quantity,
    trayType,
    trayCount,
    inputMode: mode,

    spacingRow: Number(document.getElementById("spacingRow").value),
    spacingBed: Number(document.getElementById("spacingBed").value),

    harvestPlanYM,

    notes: document.getElementById("notes").value
  };
}


// ===============================
// ★ planting/all.csv を replace 方式で保存（save-modal 対応版）
// ===============================
async function savePlantingInner() {
  console.log("💾 savePlantingInner()");

  const data = collectPlantingData();

  if (!data.plantDate) {
    alert("定植日を入力してください");
    return;
  }

  if (!data.seedRef) {
    alert("播種ロット（seedRef）を選択してください");
    return;
  }

  // ★ 先に確認アラートを出す（OK → 保存開始）
  const notes = data.notes ? data.notes.replace(/[\r\n,]/g, " ") : "";
  const confirmMsg =
    `以下の内容で保存します。\n\n` +
    `定植日: ${data.plantDate}\n` +
    `圃場: ${data.field}\n` +
    `品種: ${data.variety}\n` +
    `播種ロット: ${data.seedRef}\n` +
    `株数: ${data.quantity}\n` +
    `作業者: ${data.worker}\n` +
    `備考: ${notes || "なし"}\n\n` +
    `よろしいですか？`;

  if (!confirm(confirmMsg)) {
    return; // キャンセルされたら保存しない
  }

  // ★ OK が押されたので保存モーダル開始
  showSaveModal("保存しています…");

  // ★ seedRows はキャッシュを使う（403対策）
  const seedRows = GLOBAL_SEED_ROWS;

  // ★ planting/all.csv を読み込む
  const url = "../logs/planting/all.csv?ts=" + Date.now();
  const res = await fetch(url);
  const text = await res.text();

  let rows = [];
  if (text.trim()) {
    rows = Papa.parse(text, {
      header: true,
      skipEmptyLines: true
    }).data;
  }

  // ★ 播種ロットの残数チェック
  const planted = rows
    .filter(p => p.seedRef === data.seedRef)
    .reduce((sum, p) => sum + Number(p.quantity || 0), 0);

  let nurseryRows = [];
  try {
    nurseryRows = await loadCSV("logs/nursery/all.csv");
  } catch (e) {
    nurseryRows = [];
  }

  const seedRow = seedRows.find(r => r.seedRef === data.seedRef);
  if (!seedRow) {
    alert("選択した seedRef が seed/all.csv に存在しません");
    return;
  }

  const seedCount = Number(seedRow.seedCount);
  const discarded = nurseryRows
    .filter(n => n.seedRef === data.seedRef)
    .reduce((sum, n) => sum + Number(n.discard || 0), 0);

  const remaining = seedCount - planted - discarded;

  if (data.quantity > remaining) {
    alert(
      "植え付け株数が、この播種ロットの残り株数を超えています。\n" +
      "seedRef の選択ミス、または別日の播種ロットを合算している可能性があります。"
    );
    return;
  }

  // ★ 重複チェック
  const dup = await checkDuplicate("planting", {
    date: data.plantDate,
    field: data.field,
    variety: data.variety,
    quantity: data.quantity
  });

  if (!dup.ok) {
    alert(dup.message);
    return;
  }

  // ★ plantingRef 生成
  const plantingRef = `${data.plantDate.replace(/-/g, "")}-${data.field}-${data.variety}`;
  const machine = getMachineParam();
  const human = window.currentHuman || "";

  // ★ 新しい行を rows に追加
  rows.push({
    plantDate: data.plantDate,
    worker: data.worker.replace(/,/g, "／"),
    field: data.field,
    variety: data.variety,
    seedRef: data.seedRef,
    quantity: data.quantity,
    trayType: data.trayType,
    spacingRow: data.spacingRow,
    spacingBed: data.spacingBed,
    harvestPlanYM: data.harvestPlanYM,
    notes,
    machine,
    human,
    plantingRef
  });

  // ★ CSV 再生成
  const csvText = Papa.unparse(rows);

  // ★ replace 保存
  await saveLog("planting", "all", {}, "", csvText, "csv-replace");

  // ★ サマリー更新モードへ
  updateSaveModal("サマリーを更新しています…");

  // ★ summaryUpdate（plantingRef を渡す）
  enqueueSummaryUpdate(plantingRef);

  // ★ summaryQueueEmpty → flushSummaryPool → completeSaveModal が呼ばれる
  window.addEventListener("summaryQueueEmpty", () => {

    completeSaveModal("保存が完了しました");

    // ★ 完了後に最終確認 alert（harvest と同じ UX）
    alert(
      `定植ログを保存しました\n\n` +
      `定植日: ${data.plantDate}\n` +
      `圃場: ${data.field}\n` +
      `品種: ${data.variety}\n` +
      `播種ロット: ${data.seedRef}\n` +
      `株数: ${data.quantity}\n` +
      `作業者: ${data.worker}\n` +
      `備考: ${notes || "なし"}`
    );

    setTimeout(() => location.reload(), 500);

  }, { once: true });
}

window.savePlanting = savePlantingInner;