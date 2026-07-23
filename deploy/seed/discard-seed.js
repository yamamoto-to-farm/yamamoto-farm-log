import { loadCSV, normalizeKeys } from "/common/csv.js";
import { saveLog } from "../common/save/index.js";
import { saveTimestampRows } from "/common/timestamp.js?v=1";
import { confirmSaveBeforeSubmit } from "../common/save-modal.js";

let seedRef = "";
let seedRow = null;
let availableTrays = 0;
let availablePlants = 0;

export async function initDiscardSeedPage() {
  const params = new URLSearchParams(location.search || "");
  seedRef = String(params.get("ref") || "").trim();
  if (!seedRef) {
    alert("seedRef が指定されていません");
    return;
  }

  const [seedRowsRaw, plantingRowsRaw, discardPlantingRaw, discardSeedRaw, legacyNurseryRaw] = await Promise.all([
    loadCSV("/logs/seed/all.csv").catch(() => []),
    loadCSV("/logs/planting/all.csv").catch(() => []),
    loadCSV("/logs/discard-planting/all.csv").catch(() => []),
    loadCSV("/logs/discard-seed/all.csv").catch(() => []),
    loadCSV("/logs/nursery/all.csv").catch(() => [])
  ]);

  const seedRows = normalizeKeys(seedRowsRaw || []);
  const plantingRows = normalizeKeys(plantingRowsRaw || []);
  const discardPlantingRows = normalizeKeys(discardPlantingRaw || []);
  const discardSeedRows = normalizeKeys(discardSeedRaw || []);
  const legacyNurseryRows = normalizeKeys(legacyNurseryRaw || []);

  seedRow = seedRows.find(row => String(row.seedRef || "").trim() === seedRef) || null;
  if (!seedRow) {
    alert("該当する播種ロットが見つかりません");
    return;
  }

  const trayType = Number(seedRow.trayType || 0) || deriveTrayType(seedRow);
  const totalTrays = Number(seedRow.trayCount || 0);
  const plantedTrays = calcPlantedTrays(seedRef, plantingRows);
  const discardPlantingTrays = calcDiscardPlantingTrays(seedRef, plantingRows, discardPlantingRows);
  const discardSeedTrays = calcDiscardSeedTrays(seedRef, discardSeedRows, legacyNurseryRows, trayType);

  availableTrays = Math.max(0, round1(totalTrays - plantedTrays - discardPlantingTrays - discardSeedTrays));
  availablePlants = Math.max(0, round1(availableTrays * trayType));

  bindStaticInfo(seedRow, trayType);
  bindInputs(trayType);
}

export async function saveDiscardSeed() {
  if (!seedRow) return;

  const discardDate = String(document.getElementById("discardDate").value || "").trim();
  const discardReason = String(document.getElementById("discardReason").value || "").trim();
  const notes = String(document.getElementById("notes").value || "").trim();
  const trayType = Number(seedRow.trayType || 0) || deriveTrayType(seedRow);
  const discardTrays = round1(Number(document.getElementById("discardTrays").value || 0));
  const discardQuantity = round1(discardTrays * trayType);

  if (!discardDate) {
    alert("破棄日を入力してください");
    return;
  }
  if (!(discardTrays > 0)) {
    alert("破棄トレイ枚数を入力してください");
    return;
  }
  if (discardTrays > availableTrays + 0.0001) {
    alert("現在残っている枚数を超えて破棄できません");
    return;
  }

  const confirmed = await confirmSaveBeforeSubmit({
    lines: [
      `破棄日: ${discardDate}`,
      `播種ID: ${seedRef}`,
      `品種: ${seedRow.varietyName || ""}`,
      `破棄理由: ${discardReason || "なし"}`,
      `破棄枚数: ${formatCount(discardTrays)}枚`,
      `破棄株数: ${formatCount(discardQuantity)}株`,
      `備考: ${notes || "なし"}`
    ]
  });
  if (!confirmed) return;

  const csvLine = [
    discardDate,
    seedRef,
    csvEscape(seedRow.varietyName || ""),
    formatCount(trayType),
    formatCount(discardTrays),
    formatCount(discardQuantity),
    csvEscape(discardReason),
    csvEscape(notes.replace(/[\r\n]+/g, " ")),
    csvEscape(window.currentMachine ?? ""),
    csvEscape(window.currentHuman ?? "")
  ].join(",");

  await saveLog({
    type: "discard-seed",
    dateStr: discardDate.replace(/-/g, ""),
    csv: `${csvLine}\n`,
    summary: { date: discardDate, sourceKey: "discard-seed", count: 1 }
  });

  await saveTimestampRows([{
    date: discardDate,
    folder: "discard-seed",
    workType: "播種破棄",
    field: "",
    workers: window.currentHuman ?? "",
    machine: window.currentMachine ?? "",
    time: getCurrentTimeText()
  }]).catch(e => {
    console.warn("[discard-seed] timestamp update failed:", e);
  });

  alert(`播種ロット破棄を保存しました\n\n播種ID: ${seedRef}\n破棄枚数: ${formatCount(discardTrays)}枚\n破棄株数: ${formatCount(discardQuantity)}株`);
  setTimeout(() => {
    history.back();
  }, 300);
}

function bindStaticInfo(row, trayType) {
  document.getElementById("seedRefText").textContent = seedRef;
  document.getElementById("seedDateText").textContent = row.seedDate || "";
  document.getElementById("varietyText").textContent = row.varietyName || "";
  document.getElementById("trayInfoText").textContent = `${formatCount(row.trayCount || 0)}枚 / ${formatCount(trayType)}穴`;
  document.getElementById("remainingTrayText").textContent = `${formatCount(availableTrays)}枚`;
  document.getElementById("remainingPlantText").textContent = `${formatCount(availablePlants)}株`;

  const today = new Date().toISOString().slice(0, 10);
  document.getElementById("discardDate").value = today;
}

function bindInputs(trayType) {
  const discardTraysInput = document.getElementById("discardTrays");
  const update = () => {
    const trays = Math.max(0, Number(discardTraysInput.value || 0));
    const qty = round1(trays * trayType);
    const remainTrays = Math.max(0, round1(availableTrays - trays));
    const remainPlants = Math.max(0, round1(availablePlants - qty));

    document.getElementById("discardQuantity").textContent = formatCount(qty);
    document.getElementById("remainingAfterTray").textContent = `${formatCount(remainTrays)}枚`;
    document.getElementById("remainingAfterPlant").textContent = `${formatCount(remainPlants)}株`;
  };

  discardTraysInput.addEventListener("input", update);
  update();
}

function calcPlantedTrays(ref, plantingRows) {
  return (Array.isArray(plantingRows) ? plantingRows : []).reduce((sum, row) => {
    const refs = splitSeedRefs(row.seedRef);
    if (!refs.includes(ref)) return sum;

    const trayType = Number(row.trayType || 0) || 128;
    let trays = Number(row.trayCount || 0);
    if (!(trays > 0)) {
      const qty = Number(row.quantity || 0);
      trays = trayType > 0 ? qty / trayType : 0;
    }
    const perRef = refs.length ? trays / refs.length : 0;
    return sum + perRef;
  }, 0);
}

function calcDiscardPlantingTrays(ref, plantingRows, discardRows) {
  const plantingByRef = new Map();
  (Array.isArray(plantingRows) ? plantingRows : []).forEach(row => {
    const plantingRef = String(row.plantingRef || "").trim();
    if (plantingRef) plantingByRef.set(plantingRef, row);
  });

  return (Array.isArray(discardRows) ? discardRows : []).reduce((sum, row) => {
    const planting = plantingByRef.get(String(row.plantingRef || "").trim());
    if (!planting) return sum;

    const refs = splitSeedRefs(planting.seedRef);
    if (!refs.includes(ref)) return sum;

    const trayType = Number(planting.trayType || 0) || 128;
    const qty = Number(row.discardQuantity || row.discard || 0);
    const trays = trayType > 0 ? qty / trayType : 0;
    const perRef = refs.length ? trays / refs.length : 0;
    return sum + perRef;
  }, 0);
}

function calcDiscardSeedTrays(ref, discardSeedRows, legacyNurseryRows, trayType) {
  const currentDiscard = (Array.isArray(discardSeedRows) ? discardSeedRows : []).reduce((sum, row) => {
    if (String(row.seedRef || "").trim() !== ref) return sum;
    let trays = Number(row.discardTrays || 0);
    if (!(trays > 0)) {
      const qty = Number(row.discardQuantity || 0);
      const rowTrayType = Number(row.trayType || 0) || trayType;
      trays = rowTrayType > 0 ? qty / rowTrayType : 0;
    }
    return sum + (Number.isFinite(trays) ? trays : 0);
  }, 0);

  const legacyDiscard = (Array.isArray(legacyNurseryRows) ? legacyNurseryRows : []).reduce((sum, row) => {
    if (String(row.seedRef || "").trim() !== ref) return sum;
    return sum + Number(row.discard || 0);
  }, 0);

  return currentDiscard + legacyDiscard;
}

function splitSeedRefs(raw) {
  return String(raw || "")
    .split(/[\/／,]/)
    .map(v => String(v || "").trim())
    .filter(Boolean);
}

function deriveTrayType(row) {
  const seedCount = Number(row?.seedCount || 0);
  const trayCount = Number(row?.trayCount || 0);
  if (seedCount > 0 && trayCount > 0) return round1(seedCount / trayCount);
  return 128;
}

function round1(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

function formatCount(value) {
  const num = round1(value);
  if (Math.abs(num - Math.round(num)) < 1e-9) return String(Math.round(num));
  return String(num);
}

function csvEscape(value) {
  const text = String(value || "");
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function getCurrentTimeText() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}
