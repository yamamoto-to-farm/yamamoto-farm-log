import { saveLog } from "../common/save/index.js";

async function saveHarvest() {
  const data = collectHarvestData(); // UIから取得
  const dateStr = data.harvestDate.replace(/-/g, "");

  const csvLine = [
    data.harvestDate,
    data.shippingDate,
    data.worker,
    data.field,
    data.amount,
    data.issue,
    data.plantingRef
  ].join(",");

  await saveLog("harvest", dateStr, data, csvLine);

  alert("保存しました！");
}
function collectHarvestData() {
  return {
    harvestDate: document.getElementById("harvestDate").value,
    shippingDate: document.getElementById("shippingDate").value,

    worker: document.getElementById("worker").value,

    // 圃場は「手動優先 → 自動」
    field:
      document.getElementById("field_manual").value ||
      document.getElementById("field_auto").value,

    amount: Number(document.getElementById("amount").value),

    issue: document.getElementById("issue").value,

    // ★ 追加：紐づける定植記録（dateStr）
    plantingRef: document.getElementById("plantingRef").value
  };
}
async function loadPlantingCSV() {
  const res = await fetch("../logs/planting/all.csv");
  const text = await res.text();

  const lines = text.trim().split("\n");
  const rows = lines.slice(1);

  const list = rows.map(line => {
    const cols = line.split(",");
    return {
      plantDate: cols[0],
      worker: cols[1],
      field: cols[2],
      variety: cols[3],
      quantity: cols[4],
      spacingRow: cols[5],
      spacingBed: cols[6],
      harvestPlanYM: cols[7],
      notes: cols[8]
    };
  });

  console.log("🌱 planting CSV 読み込み結果:", list); // ← 追加

  return list;
}
function getHarvestYMRange(harvestDate) {
  const d = new Date(harvestDate);
  const list = [];

  for (let offset = -1; offset <= 1; offset++) {
    const tmp = new Date(d);
    tmp.setMonth(tmp.getMonth() + offset);
    const ym = `${tmp.getFullYear()}-${String(tmp.getMonth() + 1).padStart(2, "0")}`;
    list.push(ym);
  }

  return list;
}
async function updatePlantingRefOptions() {
  const field = getFinalField();
  const harvestDate = document.getElementById("harvestDate").value;

  if (!field || !harvestDate) return;

  const plantingList = await loadPlantingCSV();
  const ymRange = getHarvestYMRange(harvestDate);

  const select = document.getElementById("plantingRef");
  select.innerHTML = "<option value=''>該当する定植記録を選択</option>";

  plantingList
    .filter(p => p.field === field && ymRange.includes(p.harvestPlanYM))
    .forEach(p => {
      const id = p.plantDate.replace(/-/g, ""); // ← planting のファイル名と一致
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = `${p.plantDate} / ${p.variety} / ${p.quantity}株`;
      select.appendChild(opt);
    });
}