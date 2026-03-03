// ===============================
// import（必ずファイル先頭）
// ===============================
import { saveLog } from "../common/save/index.js";
import { checkDuplicate } from "../common/duplicate.js";
import { loadCSV } from "../common/csv.js";

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
// 連番は「年 × 品名」ごとにリセット
// ===============================
function setupSeedRefAuto() {
  const update = async () => {
    const date = document.getElementById("seedDate").value;
    const variety = document.getElementById("variety").value;

    if (!date || !variety) {
      document.getElementById("seedRef").value = "";
      return;
    }

    const ymd = date.replace(/-/g, ""); // 20250303
    const year = date.slice(0, 4);      // 2025
    let rows = [];

    try {
      rows = await loadCSV("/yamamoto-farm-log/logs/seed/all.csv");
    } catch (e) {
      rows = [];
    }

    // ★ 同じ「年」かつ同じ「品名」の既存レコードを対象にする
    const sameList = rows.filter(r =>
      r.seedDate?.startsWith(year) &&
      r.varietyName === variety
    );

    // ★ 連番を決定（01, 02, 03…）
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

    // ★ 例：20250303-藍天-01
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
    remainingCount: seedCount, // 初期値＝全量
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

  // 重複チェック（同じ日・品名・枚数）
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
    data.remainingCount,
    data.source,
    data.memo.replace(/[\r\n,]/g, " ")
  ].join(",");

  await saveLog("seed", dateStr, { seedRef: data.seedRef }, csvLine + "\n");

  alert("GitHubに保存しました");
}

window.saveSeed = saveSeedInner;