// ===============================
// import（必ずファイル先頭）
// ===============================
import {
  createWorkerCheckboxes,
  createFieldSelector,
  autoDetectField,
  getSelectedWorkers,
  getFinalField
} from "../common/ui.js";

import { saveLog } from "../common/save/index.js";
import { getMachineParam } from "../common/utils.js";
import { checkDuplicate } from "../common/duplicate.js";
import { saveTimestampRows } from "../common/timestamp.js?v=1";
import { loadCSV } from "../common/csv.js";
import {
  showSaveModal,
  updateSaveModal,
  completeSaveModal
} from "../common/save-modal.js";
import { enqueueSummaryUpdate } from "../common/summary.js";
import { openVarietyModal } from "/common/filter/filter-variety.js?v=1";
import { getFilterData, setFilterData } from "/common/filter/filter-core.js?v=1";
import { setupFieldModalPicker } from "/common/field-modal-picker.js?v=7";



let VARIETY_LIST = [];
let GLOBAL_SEED_ROWS = null;

// ★ 複数 seedRef の順位管理（shipping.js と同じ）
let seedRefOrder = [];

// seedRef ごとのセルトレイ種別（播種ログ由来）
const SEED_TRAY_TYPE_BY_REF = new Map();

const SUPPORTED_TRAY_TYPES = [128, 200];


// ===============================
// 初期化
// ===============================
export async function initPlantingPage() {
  createWorkerCheckboxes("workers_box");

  const fields = await createFieldSelector("field_auto", "field_area", "field_manual");
  autoDetectField("field_auto", "field_area", "field_manual");
  setupFieldModalPicker({ fields });

  // ★ seed/all.csv を1回だけ読み込む（403対策）
  GLOBAL_SEED_ROWS = await loadCSV("logs/seed/all.csv");

  await setupVarietySelector();
  applyTrayTypeFromSeedRefs();
}



// ===============================
// 品種プルダウン
// ===============================
async function setupVarietySelector() {
  const res = await fetch("../data/varieties.json");
  VARIETY_LIST = await res.json();

  setupVarietyFilterData(VARIETY_LIST);
  bindVarietyModalPicker();

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

    updateVarietyDisplay();
  });

  nameSel.addEventListener("change", () => {
    updateVarietyDisplay();
    updateSeedRefSelector();
  });
}

function setupVarietyFilterData(varietyList) {
  const byType = {};
  (Array.isArray(varietyList) ? varietyList : []).forEach(item => {
    const type = String(item?.type || "未分類").trim() || "未分類";
    const name = String(item?.name || "").trim();
    if (!name) return;
    if (!byType[type]) byType[type] = [];
    if (!byType[type].includes(name)) byType[type].push(name);
  });

  const parents = Object.keys(byType).sort((a, b) => a.localeCompare(b, "ja"));
  const children = {};
  parents.forEach(type => {
    children[type] = byType[type].slice().sort((a, b) => a.localeCompare(b, "ja"));
  });

  const current = getFilterData() || {};
  setFilterData({
    ...current,
    varieties: { parents, children }
  });
}

function calcSeedDiscardQuantity(seedRef, discardSeedRows = [], legacyNurseryRows = []) {
  const ref = String(seedRef || "").trim();
  if (!ref) return 0;

  const directDiscard = (Array.isArray(discardSeedRows) ? discardSeedRows : [])
    .filter(row => String(row?.seedRef || "").trim() === ref)
    .reduce((sum, row) => {
      let qty = Number(row.discardQuantity || 0);
      if (!Number.isFinite(qty) || qty <= 0) {
        const trays = Number(row.discardTrays || 0);
        const trayType = Number(row.trayType || 0);
        qty = Number.isFinite(trays) && Number.isFinite(trayType) ? trays * trayType : 0;
      }
      return sum + (Number.isFinite(qty) ? qty : 0);
    }, 0);

  const legacyDiscard = (Array.isArray(legacyNurseryRows) ? legacyNurseryRows : [])
    .filter(row => String(row?.seedRef || "").trim() === ref)
    .reduce((sum, row) => sum + Number(row.discard || 0), 0);

  return directDiscard + legacyDiscard;
}

function splitSeedRefs(value) {
  return String(value || "")
    .split("/")
    .map(ref => ref.trim())
    .filter(Boolean);
}

function buildSeedRemainingMap(seedRows, plantingRows, discardSeedRows = [], nurseryRows = []) {
  const remainingByRef = new Map();
  const usedByRef = new Map();

  (Array.isArray(seedRows) ? seedRows : []).forEach(row => {
    const ref = String(row?.seedRef || "").trim();
    if (!ref) return;
    const seedCount = Number(row?.seedCount || 0);
    const discarded = calcSeedDiscardQuantity(ref, discardSeedRows, nurseryRows);
    remainingByRef.set(ref, Math.max(0, seedCount - discarded));
    usedByRef.set(ref, 0);
  });

  const chronologicalPlantings = (Array.isArray(plantingRows) ? plantingRows : [])
    .map((row, index) => ({ row, index }))
    .sort((a, b) => String(a.row?.plantDate || "").localeCompare(String(b.row?.plantDate || "")) || a.index - b.index);

  chronologicalPlantings.forEach(({ row }) => {
    let quantityToAllocate = Number(row?.quantity || 0);
    if (!Number.isFinite(quantityToAllocate) || quantityToAllocate <= 0) return;

    splitSeedRefs(row?.seedRef).forEach(ref => {
      if (quantityToAllocate <= 0 || !remainingByRef.has(ref)) return;
      const available = remainingByRef.get(ref) || 0;
      const allocated = Math.min(available, quantityToAllocate);
      remainingByRef.set(ref, available - allocated);
      usedByRef.set(ref, (usedByRef.get(ref) || 0) + allocated);
      quantityToAllocate -= allocated;
    });
  });

  return { remainingByRef, usedByRef };
}

function bindVarietyModalPicker() {
  const btn = document.getElementById("openVarietyModalBtn");
  const clearBtn = document.getElementById("clearVarietyModalBtn");

  if (btn && btn.dataset.boundVarietyModal !== "1") {
    btn.dataset.boundVarietyModal = "1";
    btn.addEventListener("click", () => {
      openVarietyModal({
        mode: "select",
        onSelect: (name) => {
          applyVarietySelection(name);
        }
      });
    });
  }

  if (clearBtn && clearBtn.dataset.boundVarietyClear !== "1") {
    clearBtn.dataset.boundVarietyClear = "1";
    clearBtn.addEventListener("click", () => {
      applyVarietySelection("");
    });
  }

  updateVarietyDisplay();
}

function applyVarietySelection(name) {
  const selected = String(name || "").trim();
  const typeSel = document.getElementById("varietyType");
  const nameSel = document.getElementById("variety");
  if (!typeSel || !nameSel) return;

  if (!selected) {
    typeSel.value = "";
    typeSel.dispatchEvent(new Event("change"));
    nameSel.value = "";
    nameSel.dispatchEvent(new Event("change"));
    updateVarietyDisplay();
    return;
  }

  const item = VARIETY_LIST.find(v => String(v?.name || "").trim() === selected);
  if (!item) return;

  typeSel.value = String(item.type || "");
  typeSel.dispatchEvent(new Event("change"));
  nameSel.value = selected;
  nameSel.dispatchEvent(new Event("change"));
  updateVarietyDisplay();
}

function updateVarietyDisplay() {
  const typeSel = document.getElementById("varietyType");
  const nameSel = document.getElementById("variety");
  const display = document.getElementById("varietyModalDisplay");
  const openBtn = document.getElementById("openVarietyModalBtn");
  if (!display || !typeSel || !nameSel) return;

  const type = String(typeSel.value || "").trim();
  const name = String(nameSel.value || "").trim();
  display.value = name
    ? `${type || "未分類"} / ${name}`
    : "未選択";

  if (openBtn) openBtn.classList.toggle("is-active", !!name);
}



// ===============================
// ★ seedRef 複数選択 UI（shipping.js の UI を移植）
// ===============================
async function updateSeedRefSelector() {
  const variety = document.getElementById("variety").value;
  const area = document.getElementById("seedRefArea");

  area.innerHTML = "";
  seedRefOrder = [];
  SEED_TRAY_TYPE_BY_REF.clear();
  applyTrayTypeFromSeedRefs();

  if (!variety) return;

  const seedRows = GLOBAL_SEED_ROWS;

  const plantingRows = await loadCSV("logs/planting/all.csv").catch(() => []);
  const nurseryRows = await loadCSV("logs/nursery/all.csv").catch(() => []);
  const discardSeedRows = await loadCSV("logs/discard-seed/all.csv").catch(() => []);

  const list = seedRows.filter(r => r.varietyName === variety);
  const { remainingByRef } = buildSeedRemainingMap(seedRows, plantingRows, discardSeedRows, nurseryRows);

  for (const r of list) {
    const seedRef = r.seedRef;
    const remaining = remainingByRef.get(seedRef) || 0;

    if (remaining <= 0) continue;

    const rowTrayType = Number(r.trayType || 0);
    if (SUPPORTED_TRAY_TYPES.includes(rowTrayType)) {
      SEED_TRAY_TYPE_BY_REF.set(seedRef, rowTrayType);
    }

    const div = document.createElement("div");
    div.className = "card";

    div.innerHTML = `
      <label>
        <input type="checkbox" class="seedRefCheck" value="${seedRef}">
        ${seedRef}（残 ${remaining} 株${rowTrayType ? ` / ${rowTrayType}穴` : ""}）
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
  applyTrayTypeFromSeedRefs();
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
// セルトレイ種別ごとの入力欄（播種ロットから自動生成）
// ===============================
function getActiveTrayTypes() {
  return [...new Set(
    seedRefOrder
      .map(ref => SEED_TRAY_TYPE_BY_REF.get(ref))
      .filter(type => SUPPORTED_TRAY_TYPES.includes(type))
  )].sort((a, b) => a - b);
}

// 種別が不明なロットは先頭グループにまとめる
function getSeedRefsByTrayType(types) {
  const unknownRefs = seedRefOrder.filter(ref => !SEED_TRAY_TYPE_BY_REF.has(ref));

  return types.map((type, index) => {
    const refs = seedRefOrder.filter(ref => SEED_TRAY_TYPE_BY_REF.get(ref) === type);
    return index === 0 ? [...refs, ...unknownRefs] : refs;
  });
}

function applyTrayTypeFromSeedRefs() {
  const types = getActiveTrayTypes();
  const display = document.getElementById("trayTypeDisplay");

  if (display) {
    display.textContent = types.length
      ? `${types.map(type => `${type}穴`).join("・")}（播種ロットから自動設定）`
      : "播種ロットを選択すると自動で決まります";
  }

  renderQuantityInputs(types);
}

function renderQuantityInputs(types) {
  const container = document.getElementById("quantityInputs");
  if (!container) return;

  const signature = types.join(",");
  if (container.dataset.trayTypes === signature) return;
  container.dataset.trayTypes = signature;

  if (!types.length) {
    container.innerHTML = "";
    return;
  }

  const refsByType = getSeedRefsByTrayType(types);
  const isMixed = types.length > 1;

  container.innerHTML = types.map((type, index) => `
    <div class="form-field" data-tray-type="${type}">
      <hr style="margin: 15px 0;">
      ${isMixed ? `<label><b>${type}穴</b>（${refsByType[index].join(" → ") || "対象ロットなし"}）</label>` : ""}

      <label>入力方法</label>
      <label><input type="radio" name="mode_${type}" value="stock" checked> 株数で入力</label>
      <label><input type="radio" name="mode_${type}" value="tray"> セルトレイ枚数で入力</label>

      <div class="form-field" data-input="stock">
        <label>株数</label>
        <input type="number" class="form-input" data-field="stockCount" inputmode="decimal" step="any" min="0">
      </div>

      <div class="form-field" data-input="tray" style="display:none;">
        <label>枚数</label>
        <input type="number" class="form-input" data-field="trayCount" inputmode="decimal" step="any" min="0">

        <p>自動計算：<span data-field="calcStock">0</span> 株</p>
      </div>
    </div>
  `).join("");

  container.querySelectorAll("[data-tray-type]").forEach(block => {
    block.querySelectorAll("input[type='radio']").forEach(radio => {
      radio.addEventListener("change", () => refreshTrayBlock(block));
    });
    block.querySelector("[data-field='trayCount']")
      ?.addEventListener("input", () => refreshTrayBlock(block));
    refreshTrayBlock(block);
  });
}

function refreshTrayBlock(block) {
  const type = Number(block.dataset.trayType);
  const mode = block.querySelector("input[type='radio']:checked")?.value || "stock";

  block.querySelector("[data-input='stock']").style.display = mode === "stock" ? "block" : "none";
  block.querySelector("[data-input='tray']").style.display = mode === "tray" ? "block" : "none";

  const count = parseFloat(block.querySelector("[data-field='trayCount']").value || 0);
  block.querySelector("[data-field='calcStock']").textContent =
    Number.isFinite(count) ? count * type : 0;
}

function buildTrayGroups() {
  const types = getActiveTrayTypes();
  const refsByType = getSeedRefsByTrayType(types);

  return types.map((type, index) => {
    const block = document.querySelector(`[data-tray-type="${type}"]`);
    if (!block) return null;

    const mode = block.querySelector("input[type='radio']:checked")?.value || "stock";
    const trayCount = mode === "tray"
      ? parseFloat(block.querySelector("[data-field='trayCount']").value)
      : null;
    const quantity = mode === "tray"
      ? (Number.isFinite(trayCount) ? trayCount * type : 0)
      : Number(block.querySelector("[data-field='stockCount']").value || 0);

    return {
      trayType: type,
      trayCount,
      inputMode: mode,
      quantity: Number.isFinite(quantity) ? quantity : 0,
      seedRefs: refsByType[index]
    };
  }).filter(Boolean);
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
  const groups = buildTrayGroups();
  const quantity = groups.reduce((sum, group) => sum + (Number(group.quantity) || 0), 0);

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
    trayType: groups[0]?.trayType || 0,
    trayCount: groups[0]?.trayCount ?? null,
    inputMode: groups[0]?.inputMode || "stock",
    groups,

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
  if (!String(data.worker || "").trim()) {
    alert("作業者は必須です");
    return;
  }
  if (!data.trayType) {
    alert("播種ロットにセルトレイ種別が登録されていません");
    return;
  }
  if (!Number.isFinite(data.quantity) || data.quantity <= 0) {
    alert("植え付け株数は0より大きい数値で入力してください");
    return;
  }

  const invalidGroup = data.groups.find(group => group.quantity <= 0);
  if (invalidGroup) {
    alert(`${invalidGroup.trayType}穴の株数・枚数を入力してください。`);
    return;
  }

  const emptyGroup = data.groups.find(group => group.seedRefs.length === 0);
  if (emptyGroup) {
    alert(`${emptyGroup.trayType}穴の播種ロットが選択されていません。`);
    return;
  }

  const notes = data.notes ? data.notes.replace(/[\r\n,]/g, " ") : "";

  const trayBreakdown = data.groups
    .map(group => `  ${group.trayType}穴: ${group.quantity.toLocaleString()}株（${group.seedRefs.join(" → ")}）`)
    .join("\n");

  const confirmMsg =
    `以下の内容で保存します。\n\n` +
    `定植日: ${data.plantDate}\n` +
    `圃場: ${data.field}\n` +
    `品種: ${data.variety}\n` +
    `播種ロット:\n  ${data.seedRefs.join(" → ")}\n` +
    `トレイ種別:\n${trayBreakdown}\n` +
    `株数: ${data.quantity}\n` +
    `作業者: ${data.worker}\n` +
    `備考: ${notes || "なし"}\n\n` +
    `よろしいですか？`;

  if (!confirm(confirmMsg)) return;

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
  let discardSeedRows = [];
  try {
    nurseryRows = await loadCSV("logs/nursery/all.csv");
  } catch (e) {
    nurseryRows = [];
  }
  try {
    discardSeedRows = await loadCSV("logs/discard-seed/all.csv");
  } catch (e) {
    discardSeedRows = [];
  }

  // ===============================
  // ★ 残数チェック（複数ロットを順位順に消費）
  // ===============================
  const { remainingByRef } = buildSeedRemainingMap(seedRows, rows, discardSeedRows, nurseryRows);

  for (const group of data.groups) {
    let remain = Number(group.quantity || 0);
    let availableTotal = 0;

    for (const ref of group.seedRefs) {
      const available = remainingByRef.get(ref) || 0;
      availableTotal += available;

      const use = Math.min(available, remain);
      remain -= use;

      if (remain <= 0) break;
    }

    if (remain > 0) {
      alert(
        `選択した播種ロットの残数が不足しています。\n` +
        `トレイ種別：${group.trayType}穴\n` +
        `入力株数：${Number(group.quantity || 0).toLocaleString()} 株\n` +
        `利用可能株数：${availableTotal.toLocaleString()} 株\n` +
        `不足株数：${remain.toLocaleString()} 株`
      );
      return;
    }
  }

  showSaveModal("保存しています…");

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
  // ★ 新しい行を追加（トレイ種別ごとに1行）
  // ===============================
  data.groups.forEach(group => {
    rows.push({
      plantDate: data.plantDate,
      worker: data.worker.replace(/,/g, "／"),
      field: data.field,
      variety: data.variety,

      seedRef: group.seedRefs.join("/"),

      quantity: group.quantity,
      trayType: group.trayType,
      spacingRow: data.spacingRow,
      spacingBed: data.spacingBed,
      harvestPlanYM: data.harvestPlanYM,
      notes,
      machine,
      human,
      plantingRef
    });
  });

  const csvText = Papa.unparse(rows);

  await saveLog({
    type: "planting",
    replaceCsv: csvText,
    fileName: "all.csv",
    summary: { date: data.plantDate, sourceKey: "planting", count: data.groups.length }
  });

  await saveTimestampRows([{
    date: data.plantDate,
    folder: "planting",
    workType: "定植",
    field: data.field,
    workers: data.worker,
    machine,
    time: getCurrentTimeText()
  }]).catch(e => {
    console.warn("[planting] timestamp update failed:", e);
  });

  updateSaveModal("サマリーを更新しています…");
  enqueueSummaryUpdate(plantingRef);

  window.addEventListener(
    "summaryQueueEmpty",
    () => {
      completeSaveModal("保存が完了しました");
    },
    { once: true }
  );
}

window.savePlanting = savePlantingInner;

function getCurrentTimeText() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}
