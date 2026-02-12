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

  setupVarietySelector();
  setupInputModeSwitch();
  setupTrayAutoCalc();
});

// ============================
// 品種プルダウン
// ============================
async function setupVarietySelector() {
  const res = await fetch("../data/varieties.json");
  const list = await res.json();
  const sel = document.getElementById("variety");

  list.forEach(v => {
    const opt = document.createElement("option");
    opt.value = v.id;
    opt.textContent = v.name;
    sel.appendChild(opt);
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
// 圃場の最終決定ロジック（harvest と同じ）
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
    data.variety,
    data.quantity,
    data.spacingRow,
    data.spacingBed,
    data.notes.replace(/[\r\n,]/g, " ")
  ].join(",");

  await saveLog("planting", dateStr, data, csvLine);

  alert("GitHubに保存しました");
}

window.savePlanting = savePlantingInner;