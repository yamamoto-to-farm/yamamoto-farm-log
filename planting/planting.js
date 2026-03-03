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

let VARIETY_LIST = [];


// ===============================
// 初期化
// ===============================
export async function initPlantingPage() {

  createWorkerCheckboxes("workers_box");

  await createFieldSelector("field_auto", "field_area", "field_manual");
  autoDetectField("field_auto", "field_area", "field_manual");

  setupVarietySelector();
  setupSeedRefSelector();

  setupInputModeSwitch();
  setupTrayAutoCalc();
}


// ============================
// 品種プルダウン
// ============================
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

  // 品名が変わったら seedRef を更新
  nameSel.addEventListener("change", updateSeedRefSelector);
}


// ============================
// seedRef プルダウン
// ============================
async function setupSeedRefSelector() {
  document.getElementById("seedRef").addEventListener("change", async () => {
    const seedRef = document.getElementById("seedRef").value;
    if (!seedRef) return;

    const rows = await loadCSV("logs/seed/all.csv");
    const row = rows.find(r => r.seedRef === seedRef);

    document.getElementById("remainingCount").textContent =
      row ? row.remainingCount : "-";
  });
}


// ============================
// seedRef の更新
// ============================
async function updateSeedRefSelector() {
  const variety = document.getElementById("variety").value;
  const sel = document.getElementById("seedRef");

  sel.innerHTML = "<option value=''>選択してください</option>";
  document.getElementById("remainingCount").textContent = "-";

  if (!variety) return;

  const rows = await loadCSV("logs/seed/all.csv");

  // ★ remainingCount > 0 のロットだけ表示
  const list = rows.filter(r =>
    r.varietyName === variety &&
    Number(r.remainingCount) > 0
  );

  list.forEach(r => {
    const opt = document.createElement("option");
    opt.value = r.seedRef;
    opt.textContent = `${r.seedRef}（残 ${r.remainingCount} 株）`;
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


// ============================
// 圃場の最終決定
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

  if (harvestMonth <= d.getMonth() + 1) {
    year += 1;
  }

  return `${year}-${String(harvestMonth).padStart(2, "0")}`;
}


// ============================
// 入力データ収集
// ============================
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


// ============================
// remainingCount 更新
// ============================
async function updateSeedRemaining(seedRef, used) {
  const rows = await loadCSV("logs/seed/all.csv");

  const target = rows.find(r => r.seedRef === seedRef);
  if (!target) return;

  const newRemain = Number(target.remainingCount) - used;
  target.remainingCount = Math.max(newRemain, 0);

  // CSV 再構築
  const header = Object.keys(rows[0]).join(",");
  const body = rows.map(r => Object.values(r).join(",")).join("\n");

  await saveLog("seed", "all", {}, header + "\n" + body + "\n");
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

  if (!data.seedRef) {
    alert("播種ロット（seedRef）を選択してください");
    return;
  }

  // ★ remainingCount チェック
  const rows = await loadCSV("logs/seed/all.csv");
  const row = rows.find(r => r.seedRef === data.seedRef);

  if (!row) {
    alert("選択した seedRef が見つかりません");
    return;
  }

  const remaining = Number(row.remainingCount);

  if (data.quantity > remaining) {
    alert(
      "植え付け株数が、この播種ロットの残り株数を超えています。\n" +
      "seedRef の選択ミス、または別日の播種ロットを合算している可能性があります。"
    );
    return;
  }

  // 重複チェック
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

  const plantingRef = `${data.plantDate.replace(/-/g, "")}-${data.field}-${data.variety}`;

  const machine = getMachineParam();
  const human = window.currentHuman || "";
  const dateStr = data.plantDate.replace(/-/g, "");

  const csvLine = [
    data.plantDate,
    data.worker.replace(/,/g, "／"),
    data.field,
    data.variety,
    data.seedRef,        // ★ 追加
    data.quantity,
    data.trayType,
    data.spacingRow,
    data.spacingBed,
    data.harvestPlanYM,
    data.notes.replace(/[\r\n,]/g, " "),
    machine,
    human,
    plantingRef
  ].join(",");

  // ★ remainingCount を減算
  await updateSeedRemaining(data.seedRef, data.quantity);

  // 定植ログ保存
  await saveLog("planting", dateStr, { plantingRef }, csvLine + "\n");

  alert("GitHubに保存しました");
}

window.savePlanting = savePlantingInner;