import {
  createWorkerCheckboxes,
  createFieldSelector,
  autoDetectField,
  getSelectedWorkers
} from "../common/ui.js";

import { saveLog } from "../common/save/index.js";

import { showPinGate } from "../common/ui.js";

window.addEventListener("DOMContentLoaded", () => {
  showPinGate("pin-area", () => {
    document.getElementById("form-area").style.display = "block";
  });
});

let VARIETY_LIST = []; // ★ 品種データを保持する

// ============================
// 初期化
// ============================
window.addEventListener("DOMContentLoaded", () => {
  createWorkerCheckboxes("workers_box");

  createFieldSelector("field_auto", "field_area", "field_manual")
    .then(() => {
      autoDetectField("field_auto", "field_area", "field_manual");
    });

  setupVarietySelector();
  setupInputModeSwitch();
  setupTrayAutoCalc();
});

// ============================
// 品種プルダウン（type → name）
// ============================
async function setupVarietySelector() {
  const res = await fetch("../data/varieties.json");
  VARIETY_LIST = await res.json();   // ★ 保存しておく

  const typeSel = document.getElementById("varietyType");
  const nameSel = document.getElementById("variety");

  // ▼ タイプ一覧（寒玉 / 初夏 / レッド）
  const types = [...new Set(VARIETY_LIST.map(v => v.type))];
  types.forEach(t => {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = t;
    typeSel.appendChild(opt);
  });

  // ▼ タイプ選択で品種を絞り込み
  typeSel.addEventListener("change", () => {
    const selectedType = typeSel.value;
    nameSel.innerHTML = "<option value=''>品名を選択</option>";

    if (!selectedType) return;

    const filtered = VARIETY_LIST.filter(v => v.type === selectedType);

    filtered.forEach(v => {
      const opt = document.createElement("option");
      opt.value = v.name;      // ★ id → name に統一
      opt.textContent = v.name;
      nameSel.appendChild(opt);
    });
  });
}

// ============================
// 株数 / 枚数 切り替え
// ============================
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

// ============================
// 枚数 → 株数 自動計算
// ============================
function setupTrayAutoCalc() {
  const update = () => {
    const count = Number(document.getElementById("trayCount").value || 0);
    const type = Number(document.querySelector("input[name='trayType']:checked").value);
    document.getElementById("calcStock").textContent = count * type;
  };

  document.getElementById("trayCount").addEventListener("input", update);
  document.querySelectorAll("input[name='trayType']").forEach(r => r.addEventListener("change", update));
}

// ============================
// 圃場の最終決定ロジック
// ============================
function getFinalField() {
  const auto = document.getElementById("field_auto").value;
  const manual = document.getElementById("field_manual").value;
  const confirmed = document.getElementById("field_confirm").checked;

  if (confirmed) return auto;
  if (manual) return manual;
  return auto;
}

// ============================
// 収穫予定年月の自動計算
// ============================
function calcHarvestPlanYM(plantDate, harvestMonth) {
  const d = new Date(plantDate);
  let year = d.getFullYear();

  // 収穫月が定植月より前なら翌年
  if (harvestMonth <= d.getMonth() + 1) {
    year += 1;
  }

  return `${year}-${String(harvestMonth).padStart(2, "0")}`;
}

// ============================
// 入力データ収集（name ベース版）
// ============================
function collectPlantingData() {
  const mode = document.querySelector("input[name='mode']:checked").value;

  let quantity = 0;
  let trayCount = null;
  let trayType = null;

  if (mode === "stock") {
    quantity = Number(document.getElementById("stockCount").value);
  } else {
    trayCount = Number(document.getElementById("trayCount").value);
    trayType = Number(document.querySelector("input[name='trayType']:checked").value);
    quantity = trayCount * trayType;
  }

  // ▼ id → name に変更
  const varietyName = document.getElementById("variety").value;

  // ▼ name で検索
  const variety = VARIETY_LIST.find(v => v.name === varietyName);

  // ▼ 自動計算（harvestMonth を使用）
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

    // ▼ 保存するのも name
    variety: varietyName,

    quantity,
    inputMode: mode,
    trayCount,
    trayType,

    spacingRow: Number(document.getElementById("spacingRow").value),
    spacingBed: Number(document.getElementById("spacingBed").value),

    harvestPlanYM,

    notes: document.getElementById("notes").value
  };
}

// ============================
// 保存処理
// ============================
async function savePlantingInner() {
  const data = collectPlantingData();

  if (!data.plantDate) {
    alert("定植日を入力してください");
    return;
  }

  const dateStr = data.plantDate.replace(/-/g, "");

  const csvLine = [
    data.plantDate,
    data.worker.replace(/,/g, "／"),
    data.field,
    data.variety,     // ← name が入る
    data.quantity,
    data.spacingRow,
    data.spacingBed,
    data.harvestPlanYM,
    data.notes.replace(/[\r\n,]/g, " ")
  ].join(",");

  await saveLog("planting", dateStr, data, csvLine);

  alert("GitHubに保存しました");
}

window.savePlanting = savePlantingInner;