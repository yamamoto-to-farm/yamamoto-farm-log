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
import {
  showSaveModal,
  updateSaveModal,
  completeSaveModal
} from "../common/save-modal.js";
import { enqueueSummaryUpdate } from "../common/summary.js";

let VARIETY_LIST = [];
let GLOBAL_SEED_ROWS = null;

// ★ 複数 seedRef の順位管理（shipping.js と同じ）
let seedRefOrder = [];


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
// ★ seedRef 複数選択 UI（shipping.js の UI を移植）
// ===============================
async function updateSeedRefSelector() {
  const variety = document.getElementById("variety").value;
  const area = document.getElementById("seedRefArea");

  area.innerHTML = "";
  seedRefOrder = [];

  if (!variety) return;

  const seedRows = GLOBAL_SEED_ROWS;

  const plantingRows = await loadCSV("logs/planting/all.csv").catch(() => []);
  const nurseryRows = await loadCSV("logs/nursery/all.csv").catch(() => []);

  const list = seedRows.filter(r => r.varietyName === variety);

  for (const r of list) {
    const seedRef = r.seedRef;
    const seedCount = Number(r.seedCount);

    const planted = plantingRows
      .filter(p => (p.seedRef || "").split("/").includes(seedRef))
      .reduce((sum, p) => sum + Number(p.quantity || 0), 0);

    const discarded = nurseryRows
      .filter(n => n.seedRef === seedRef)
      .reduce((sum, n) => sum + Number(n.discard || 0), 0);

    const remaining = seedCount - planted - discarded;

    if (remaining <= 0) continue;

    const div = document.createElement("div");
    div.className = "card";

    div.innerHTML = `
      <label>
        <input type="checkbox" class="seedRefCheck" value="${seedRef}">
        ${seedRef}（残 ${remaining} 株）
      </label>
      <span class="order-label" data-key="${seedRef}">順番：－</span>
    `;

    const cb = div.querySelector(".seedRefCheck");
    cb.addEventListener("change", () => onSeedRefCheckChange(seedRef, cb.checked));

    area.appendChild(div);
  }
}



// ===============================
// ★ 順位管理（shipping.js と同じ）
// ===============================
function onSeedRefCheckChange(ref, checked) {
  if (checked) {
    if (!seedRefOrder.includes(ref)) seedRefOrder.push(ref);
  } else {
    seedRefOrder = seedRefOrder.filter(r => r !== ref);
  }
  updateSeedRefOrderLabels();
}

function updateSeedRefOrderLabels() {
  seedRefOrder.forEach((ref, idx) => {
    const label = document.querySelector(`.order-label[data-key="${ref}"]`);
    if (label) label.textContent = `順番：${idx + 1}`;
  });

  document.querySelectorAll(".order-label").forEach(label => {
    const ref = label.dataset.key;
    if (!seedRefOrder.includes(ref)) {
      label.textContent = "順番：－";
    }
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
      document.getElementById("stock-input").style.display =
        mode === "stock" ? "block" : "none";
      document.getElementById("tray-input").style.display =
        mode === "tray" ? "block" : "none";
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
  document
    .querySelectorAll("input[name='trayType']")
    .forEach(r => r.addEventListener("change", update));
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
// 入力データ収集（複数 seedRef 対応）
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

    // ★ 複数 seedRef
    seedRefs: seedRefOrder,

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
// ★ 保存処理（複数 seedRef 完全対応版）
// ===============================
async function savePlantingInner() {
  console.log("💾 savePlantingInner()");

  const data = collectPlantingData();

  if (!data.plantDate) {
    alert("定植日を入力してください");
    return;
  }

  if (!data.seedRefs || data.seedRefs.length === 0) {
    alert("播種ロット（seedRef）を選択してください");
    return;
  }

  const notes = data.notes ? data.notes.replace(/[\r\n,]/g, " ") : "";

  const confirmMsg =
    `以下の内容で保存します。\n\n` +
    `定植日: ${data.plantDate}\n` +
    `圃場: ${data.field}\n` +
    `品種: ${data.variety}\n` +
    `播種ロット:\n  ${data.seedRefs.join(" → ")}\n` +
    `株数: ${data.quantity}\n` +
    `作業者: ${data.worker}\n` +
    `備考: ${notes || "なし"}\n\n` +
    `よろしいですか？`;

  if (!confirm(confirmMsg)) return;

  showSaveModal("保存しています…");

  const seedRows = GLOBAL_SEED_ROWS;

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

  let nurseryRows = [];
  try {
    nurseryRows = await loadCSV("logs/nursery/all.csv");
  } catch (e) {
    nurseryRows = [];
  }

  // ===============================
  // ★ 残数チェック（複数ロットを順位順に消費）
  // ===============================
  let remain = data.quantity;

  for (const ref of data.seedRefs) {
    const seedRow = seedRows.find(r => r.seedRef === ref);
    if (!seedRow) continue;

    const seedCount = Number(seedRow.seedCount);

    const planted = rows
      .filter(p => (p.seedRef || "").split("/").includes(ref))
      .reduce((sum, p) => sum + Number(p.quantity || 0), 0);

    const discarded = nurseryRows
      .filter(n => n.seedRef === ref)
      .reduce((sum, n) => sum + Number(n.discard || 0), 0);

    const available = seedCount - planted - discarded;

    const use = Math.min(available, remain);
    remain -= use;

    if (remain <= 0) break;
  }

  if (remain > 0) {
    alert("選択した seedRef の残数が不足しています");
    return;
  }

  // ===============================
  // ★ 重複チェック
  // ===============================
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

  // ===============================
  // ★ plantingRef（現状維持）
  // ===============================
  const plantingRef = `${data.plantDate.replace(/-/g, "")}-${data.field}-${data.variety}`;
  const machine = getMachineParam();
  const human = window.currentHuman || "";

  // ===============================
  // ★ 新しい行を追加（複数 seedRef）
  // ===============================
  rows.push({
    plantDate: data.plantDate,
    worker: data.worker.replace(/,/g, "／"),
    field: data.field,
    variety: data.variety,

    seedRef: data.seedRefs.join("/"),

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

  const csvText = Papa.unparse(rows);

  await saveLog("planting", "all", {}, "", csvText, "csv-replace");

  updateSaveModal("サマリーを更新しています…");
  enqueueSummaryUpdate(plantingRef);

  window.addEventListener(
    "summaryQueueEmpty",
    () => {
      completeSaveModal("保存が完了しました");

      alert(
        `定植ログを保存しました\n\n` +
          `定植日: ${data.plantDate}\n` +
          `圃場: ${data.field}\n` +
          `品種: ${data.variety}\n` +
          `播種ロット:\n  ${data.seedRefs.join(" → ")}\n` +
          `株数: ${data.quantity}\n` +
          `作業者: ${data.worker}\n` +
          `備考: ${notes || "なし"}`
      );

      setTimeout(() => location.reload(), 500);
    },
    { once: true }
  );
}

window.savePlanting = savePlantingInner;