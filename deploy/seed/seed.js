// ===============================
// import（必ずファイル先頭）
// ===============================
import { saveLog } from "../common/save/index.js";
import { checkDuplicate } from "../common/duplicate.js";
import { loadCSV } from "../common/csv.js";
import { saveTimestampRows } from "/common/timestamp.js?v=1";
import { openVarietyModal } from "/common/filter/filter-variety.js?v=1";
import { getFilterData, setFilterData } from "/common/filter/filter-core.js?v=1";

// 品種リスト
let VARIETY_LIST = [];


// ===============================
// 初期化
// ===============================
export async function initSeedPage() {
  await setupVarietySelector();
  setupTrayAutoCalc();
  setupSeedRefAuto();
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

  nameSel.addEventListener("change", updateVarietyDisplay);
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
  if (!display || !typeSel || !nameSel) return;

  const type = String(typeSel.value || "").trim();
  const name = String(nameSel.value || "").trim();
  display.value = name
    ? `${type || "未分類"} / ${name}`
    : "未選択";
}


// ===============================
// トレイ枚数 → 株数 自動計算
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
// seedRef 自動生成（YYYYMMDD-品名-連番）
// ===============================
function setupSeedRefAuto() {
  const update = async () => {
    const date = document.getElementById("seedDate").value;
    const variety = document.getElementById("variety").value;

    if (!date || !variety) {
      document.getElementById("seedRef").value = "";
      return;
    }

    const ymd = date.replace(/-/g, "");
    const year = date.slice(0, 4);
    let rows = [];

    try {
      // ★ AWS 版：相対パスに統一
      rows = await loadCSV("../logs/seed/all.csv");
    } catch (e) {
      rows = [];
    }

    const sameList = rows.filter(r =>
      r.seedDate?.startsWith(year) &&
      r.varietyName === variety
    );

    let nextNo = 1;
    if (sameList.length > 0) {
      const nums = sameList
        .map(r => {
          const parts = r.seedRef.split("-");
          return Number(parts[2] || 0);
        })
        .filter(n => !isNaN(n));

      if (nums.length > 0) {
        nextNo = Math.max(...nums) + 1;
      }
    }

    const noStr = String(nextNo).padStart(2, "0");
    const ref = `${ymd}-${variety}-${noStr}`;
    document.getElementById("seedRef").value = ref;
  };

  document.getElementById("seedDate").addEventListener("change", update);
  document.getElementById("variety").addEventListener("change", update);
}


// ===============================
// 入力データ収集
// ===============================
function collectSeedData() {
  const trayType = Number(document.querySelector("input[name='trayType']:checked").value);
  const trayCount = parseFloat(document.getElementById("trayCount").value || 0);
  const seedCount = trayType * trayCount;

  return {
    seedDate: document.getElementById("seedDate").value,
    varietyName: document.getElementById("variety").value,
    trayType,
    trayCount,
    seedCount,
    remainingCount: seedCount,
    source: document.querySelector("input[name='source']:checked").value,
    memo: document.getElementById("memo").value,
    seedRef: document.getElementById("seedRef").value
  };
}


// ===============================
// 保存処理（logs/seed/all.csv）
// ===============================
async function saveSeedInner() {
  const data = collectSeedData();

  if (!data.seedDate) {
    alert("播種日を入力してください");
    return;
  }
  if (!data.varietyName) {
    alert("品名を選択してください");
    return;
  }
  if (!data.trayCount || data.trayCount <= 0) {
    alert("トレイ枚数を入力してください");
    return;
  }
  if (!String(data.worker || "").trim()) {
    alert("作業者は必須です");
    return;
  }

  const dup = await checkDuplicate("seed", {
    date: data.seedDate,
    variety: data.varietyName,
    trayCount: data.trayCount
  });

  if (!dup.ok) {
    alert(dup.message);
    return;
  }

  const dateStr = data.seedDate.replace(/-/g, "");

  const csvLine = [
    data.seedRef,
    data.seedDate,
    data.varietyName,
    data.trayType,
    data.trayCount,
    data.seedCount,
    data.source,
    data.memo.replace(/[\r\n,]/g, " ")
  ].join(",");

  await saveLog({
    type: "seed",
    dateStr,
    csv: csvLine + "\n",
    summary: { date: data.seedDate, sourceKey: "seed", count: 1 }
  });

  await saveTimestampRows([{
    date: data.seedDate,
    folder: "seed",
    workType: "播種",
    field: "",
    workers: data.worker,
    machine: "",
    time: getCurrentTimeText()
  }]).catch(e => {
    console.warn("[seed] timestamp update failed:", e);
  });

}

window.saveSeed = saveSeedInner;

function getCurrentTimeText() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}
