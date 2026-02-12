import {
  createWorkerCheckboxes,
  createFieldSelector,
  autoDetectField,
  getSelectedWorkers
} from "../common/ui.js";

import { saveLog } from "../common/save/index.js";

// ============================
// 初期化
// ============================
window.addEventListener("DOMContentLoaded", () => {
  createWorkerCheckboxes("workers_box");

  createFieldSelector("field_auto", "field_area", "field_manual")
    .then(() => {
      autoDetectField("field_auto", "field_area", "field_manual");
    });

  setupVarietySelector();   // ← ここが新しくなる
  setupInputModeSwitch();
  setupTrayAutoCalc();
});

// ============================
// 品種プルダウン（type → name）
// ============================
async function setupVarietySelector() {
  const res = await fetch("../data/varieties.json");
  const list = await res.json();

  const typeSel = document.getElementById("varietyType");
  const nameSel = document.getElementById("variety");

  // --- 種別一覧を生成 ---
  const types = [...new Set(list.map(v => v.type))];
  types.forEach(t => {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = t;
    typeSel.appendChild(opt);
  });

  // --- 種別が選ばれたら品名を絞り込み ---
  typeSel.addEventListener("change", () => {
    const selectedType = typeSel.value;

    // 初期化
    nameSel.innerHTML = "<option value=''>品名を選択</option>";

    if (!selectedType) return;

    const filtered = list.filter(v => v.type === selectedType);

    filtered.forEach(v => {
      const opt = document.createElement("option");
      opt.value = v.id;      // 保存するのは id
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
// 入力データ収集
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

  return {
    plantDate: document.getElementById("plantDate").value,
    worker: getSelectedWorkers("workers_box", "temp_workers"),
    field: getFinalField(),

    // ★ ここが重要：選ばれた品種の id を保存
    variety: document.getElementById("variety").value,

    quantity,
    inputMode: mode,
    trayCount,
    trayType,

    spacingRow: Number(document.getElementById("spacingRow").value),
    spacingBed: Number(document.getElementById("spacingBed").value),

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
    data.worker,
    data.field,
    data.variety,   // ← id が入る
    data.quantity,
    data.spacingRow,
    data.spacingBed,
    data.notes.replace(/[\r\n,]/g, " ")
  ].join(",");

  await saveLog("planting", dateStr, data, csvLine);

  alert("GitHubに保存しました");
}

window.savePlanting = savePlantingInner;