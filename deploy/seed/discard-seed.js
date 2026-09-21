import { loadCSV, normalizeKeys } from "/common/csv.js";
import { saveLog } from "../common/save/index.js";
import { saveTimestampRows } from "/common/timestamp.js?v=1";
import { confirmSaveBeforeSubmit } from "../common/save-modal.js";
import { todayLocalYmd } from "/common/date-utils.js?v=1";
import { buildSeedRemainingMap } from "/common/seed-remaining.js?v=1";

const DISCARD_REASON_OPTIONS = [
  { value: "補植余り", label: "補植余り" },
  { value: "育苗不良", label: "育苗不良" },
  { value: "病害", label: "病害" },
  { value: "暑さ障害", label: "暑さ障害" },
  { value: "寒害", label: "寒害" },
  { value: "徒長", label: "徒長" },
  { value: "その他", label: "その他" }
];

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

  const [seedRowsRaw, plantingRowsRaw, discardSeedRaw, legacyNurseryRaw] = await Promise.all([
    loadCSV("/logs/seed/all.csv").catch(() => []),
    loadCSV("/logs/planting/all.csv").catch(() => []),
    loadCSV("/logs/discard-seed/all.csv").catch(() => []),
    loadCSV("/logs/nursery/all.csv").catch(() => [])
  ]);

  const seedRows = normalizeKeys(seedRowsRaw || []);
  const plantingRows = normalizeKeys(plantingRowsRaw || []);
  const discardSeedRows = normalizeKeys(discardSeedRaw || []);
  const legacyNurseryRows = normalizeKeys(legacyNurseryRaw || []);

  seedRow = seedRows.find(row => String(row.seedRef || "").trim() === seedRef) || null;
  if (!seedRow) {
    alert("該当する播種ロットが見つかりません");
    return;
  }

  const trayType = Number(seedRow.trayType || 0) || deriveTrayType(seedRow);

  // 残数計算は /common/seed-remaining.js に統一（一覧・定植ページと共通化）
  const { remainingByRef } = buildSeedRemainingMap(seedRows, plantingRows, discardSeedRows, legacyNurseryRows);
  const remainingPlants = Math.max(0, Number(remainingByRef.get(seedRef) || 0));

  availableTrays = trayType > 0 ? round1(remainingPlants / trayType) : 0;
  availablePlants = Math.max(0, round1(availableTrays * trayType));

  bindStaticInfo(seedRow, trayType);
  setupReasonSelector();
  bindInputs(trayType);
}

export function goBackFromDiscardSeed() {
  const params = new URLSearchParams(location.search || "");
  const returnPath = String(params.get("return") || "").trim();
  if (returnPath && returnPath.startsWith("/")) {
    location.href = returnPath;
    return;
  }
  history.back();
}

export async function saveDiscardSeed() {
  if (!seedRow) return;

  const discardDate = String(document.getElementById("discardDate").value || "").trim();
  const discardReason = getDiscardReasonValue();
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
  if (!discardReason) {
    alert("破棄理由を選択してください");
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
    goBackFromDiscardSeed();
  }, 300);
}

function setupReasonSelector() {
  const select = document.getElementById("discardReason");
  if (!(select instanceof HTMLSelectElement)) return;

  select.innerHTML = DISCARD_REASON_OPTIONS.map(option => (
    `<option value="${escapeAttr(option.value)}">${escapeHtml(option.label)}</option>`
  )).join("");

  select.addEventListener("change", syncReasonDetailVisibility);
  syncReasonDetailVisibility();
}

function syncReasonDetailVisibility() {
  const select = document.getElementById("discardReason");
  const detailField = document.getElementById("discardReasonDetailField");
  const detailInput = document.getElementById("discardReasonDetail");
  if (!(select instanceof HTMLSelectElement) || !(detailField instanceof HTMLElement) || !(detailInput instanceof HTMLInputElement)) return;

  const isOther = String(select.value || "") === "その他";
  detailField.style.display = isOther ? "block" : "none";
  if (!isOther) detailInput.value = "";
}

function getDiscardReasonValue() {
  const select = document.getElementById("discardReason");
  const detailInput = document.getElementById("discardReasonDetail");
  const reason = String(select?.value || "").trim();
  if (reason !== "その他") return reason;

  const detail = String(detailInput?.value || "").trim();
  return detail ? `その他:${detail}` : "";
}

function bindStaticInfo(row, trayType) {
  document.getElementById("seedRefText").textContent = seedRef;
  document.getElementById("seedDateText").textContent = row.seedDate || "";
  document.getElementById("varietyText").textContent = row.varietyName || "";
  document.getElementById("trayInfoText").textContent = `${formatCount(row.trayCount || 0)}枚 / ${formatCount(trayType)}穴`;
  document.getElementById("remainingTrayText").textContent = `${formatCount(availableTrays)}枚`;
  document.getElementById("remainingPlantText").textContent = `${formatCount(availablePlants)}株`;

  const today = todayLocalYmd();
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

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function getCurrentTimeText() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}
