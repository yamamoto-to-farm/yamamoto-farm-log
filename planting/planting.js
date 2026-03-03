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
// seedRef プルダウン更新（計算方式）
// ===============================
async function updateSeedRefSelector() {
  const variety = document.getElementById("variety").value;
  const sel = document.getElementById("seedRef");
  const remainSpan = document.getElementById("remainingCount");

  sel.innerHTML = "<option value=''>選択してください</option>";
  remainSpan.textContent = "-";

  if (!variety) return;

  const seedRows = await loadCSV("logs/seed/all.csv");
  const plantingRows = await loadCSV("logs/planting/all.csv").catch(() => []);

  // ★ nursery がまだ無い場合は空配列
  let nurseryRows = [];
  try {
    nurseryRows = await loadCSV("logs/nursery/all.csv");
  } catch (e) {
    nurseryRows = [];
  }

  const list = seedRows.filter(r => r.varietyName === variety);

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

  sel.addEventListener("change", async () => {
    const seedRef = sel.value;
    if (!seedRef) {
      remainSpan.textContent = "-";
      return;
    }

    const seedRow = seedRows.find(r => r.seedRef === seedRef);
    const seedCount = Number(seedRow.seedCount);

    const planted = plantingRows
      .filter(p => p.seedRef === seedRef)
      .reduce((sum, p) => sum + Number(p.quantity || 0), 0);

    const discarded = nurseryRows
      .filter(n => n.seedRef === seedRef)
      .reduce((sum, n) => sum + Number(n.discard || 0), 0);

    const remaining = seedCount - planted - discarded;

    remainSpan.textContent = remaining;
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
// 保存処理（計算方式）
// ===============================
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

  // ★ 最新の remainingCount を再計算（nursery が無くても安全）
  const seedRows = await loadCSV("logs/seed/all.csv");
  const plantingRows = await loadCSV("logs/planting/all.csv").catch(() => []);

  let nurseryRows = [];
  try {
    nurseryRows = await loadCSV("logs/nursery/all.csv");
  } catch (e) {
    nurseryRows = [];
  }

  const seedRow = seedRows.find(r => r.seedRef === data.seedRef);
  if (!seedRow) {
    alert("選択した seedRef が見つかりません");
    return;
  }

  const seedCount = Number(seedRow.seedCount);

  const planted = plantingRows
    .filter(p => p.seedRef === data.seedRef)
    .reduce((sum, p) => sum + Number(p.quantity || 0), 0);

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
    data.seedRef,
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

  await saveLog("planting", dateStr, { plantingRef }, csvLine + "\n");

  alert("GitHubに保存しました");
}

window.savePlanting = savePlantingInner;