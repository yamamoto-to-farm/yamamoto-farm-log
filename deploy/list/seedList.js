// ===============================
// seedList.js（播種ベース一覧）
// ===============================

import { loadCSV, normalizeKeys } from "/common/csv.js";
import { loadJSON } from "/common/json.js";
import { calcAreaM2, calcAreaTan } from "/analysis/analysis-utils.js";

import {
  openYearModal,
  openFieldModal,
  openVarietyModal,
  setFilterData
} from "/common/filter.js";

import { showInfoModal } from "/common/showInfoModal.js";

let seedRows = [];
let plantingRows = [];
let varietyData = [];
let canDiscard = false;

let filterData = {};
let initialized = false;

/* ============================================================
   外部から呼ばれるエントリポイント
============================================================ */
export async function renderSeedList() {
  if (!initialized) {
    await initSeedListPage();
    initialized = true;
  }
  const state = window.currentFilterState || {};
  const filtered = applyAllFilters(seedRows, state);
  renderTable(filtered);
}

/* ============================================================
   初期化
============================================================ */
async function initSeedListPage() {

  if (window.currentRole === "admin") canDiscard = true;

  seedRows = normalizeKeys(await loadCSV("/logs/seed/all.csv"));
  plantingRows = normalizeKeys(await loadCSV("/logs/planting/all.csv"));
  varietyData = await loadJSON("/data/varieties.json");

  /* ▼ 年 → 月マップ生成 */
  const ymMap = {};
  seedRows.forEach(r => {
    if (!r.seedDate) return;
    const y = r.seedDate.slice(0, 4);
    const m = r.seedDate.slice(5, 7);
    if (!ymMap[y]) ymMap[y] = [];
    if (!ymMap[y].includes(m)) ymMap[y].push(m);
  });
  Object.keys(ymMap).forEach(y => ymMap[y].sort());

  /* ▼ 品種 type → name */
  const typeMap = {};
  const typeOrder = [];
  varietyData.forEach(v => {
    if (!typeMap[v.type]) {
      typeMap[v.type] = [];
      typeOrder.push(v.type);
    }
    typeMap[v.type].push(v.name);
  });

  filterData = {
    years: Object.keys(ymMap).sort(),
    months: ymMap,
    fields: { parents: [], children: {} }, // 播種一覧は圃場なし
    varieties: { parents: typeOrder, children: typeMap }
  };

  setFilterData(filterData);

  document.querySelector('[data-type="year"]').addEventListener("click", openYearModal);
  document.querySelector('[data-type="field"]').addEventListener("click", openFieldModal);
  document.querySelector('[data-type="variety"]').addEventListener("click", openVarietyModal);

  window.addEventListener("filter:apply", (e) => {
    window.currentFilterState = e.detail;
    renderTable(applyAllFilters(seedRows, e.detail));
  });

  window.addEventListener("filter:reset", () => {
    window.currentFilterState = {};
    renderTable(seedRows);
  });
}

/* ============================================================
   フィルタ適用
============================================================ */
function applyAllFilters(rows, state) {

  let result = rows;

  if (state.yearMonths?.length) {
    result = result.filter(r => {
      const y = r.seedDate?.slice(0, 4);
      const m = r.seedDate?.slice(5, 7);
      return state.yearMonths.includes(`${y}-${m}`);
    });
  }

  if (state.varieties?.length) {
    result = result.filter(r => state.varieties.includes(r.varietyName));
  }

  return result;
}

/* ============================================================
   定植ID（seedRef → plantingRef[]）
============================================================ */
function getPlantingRefs(seedRef) {
  if (!seedRef) return [];

  const clean = s => (s ?? "").replace(/\s+/g, "").trim();
  const refs = seedRef.split(",").map(s => clean(s));

  const plantingRefs = [];

  plantingRows.forEach(r => {
    if (!r.seedRef) return;
    const srefs = r.seedRef.split(",").map(s => clean(s));
    if (srefs.some(s => refs.includes(s))) {
      plantingRefs.push(r.plantingRef);
    }
  });

  return plantingRefs;
}

/* ============================================================
   モーダル用データ
============================================================ */
function getSeedDetail(row) {
  return {
    title: `播種情報：${row.seedRef}`,
    html: `
      <p><b>播種ID：</b>${row.seedRef}</p>
      <p><b>株数：</b>${row.seedCount}</p>
      <p><b>トレイ種別：</b>${row.trayType}</p>
      <p><b>メモ：</b><br>${row.memo ?? ""}</p>
      <p><b>種子の種類：</b>${row.source ?? ""}</p>

      <p><b>備考：</b><br>
        ※予定面積は 株間：34cm / 畝間：60cm を基準に計算しています
      </p>
    `
  };
}

/* ============================================================
   予定面積(反)（株間34cm / 畝間60cm）
============================================================ */
function calcSeedAreaTan(seedCount) {
  const spacingRow = 34;
  const spacingBed = 60;
  const areaM2 = calcAreaM2(seedCount, spacingRow, spacingBed);
  return calcAreaTan(areaM2);
}

/* ============================================================
   テーブル描画
============================================================ */
function renderTable(rows) {

  const tableArea = document.getElementById("table-area");

  let html = `
    <table>
      <thead>
        <tr>
          <th>播種日</th>
          <th>品種</th>
          <th>枚数</th>
          <th>予定面積(反)</th>
          <th>定植ID</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
  `;

  let totalTray = 0;
  let totalSeed = 0;
  let totalAreaTan = 0;

  rows.forEach(r => {

    const tray = Number(r.trayCount || 0);
    const seedCount = Number(r.seedCount || 0);
    const areaTan = calcSeedAreaTan(seedCount);

    totalTray += tray;
    totalSeed += seedCount;
    totalAreaTan += areaTan;

    const plantingRefs = getPlantingRefs(r.seedRef);
    const plantingHtml = plantingRefs.length ? plantingRefs.join("<br>") : "-";

    html += `<tr>
      <td class="seed-date-cell" data-id="${r.seedRef}">${r.seedDate ?? ""}</td>
      <td>${r.varietyName ?? ""}</td>
      <td>${tray}</td>
      <td>${areaTan.toFixed(3)}</td>
      <td>${plantingHtml}</td>
      <td>${canDiscard ? `<button class="primary-btn discard-btn" data-ref="${r.seedRef}">破棄</button>` : ""}</td>
    </tr>`;
  });

  html += `
      </tbody>
    </table>
  `;

  document.getElementById("countArea").textContent = `${rows.length} 件`;
  document.getElementById("summaryArea").innerHTML =
    `総枚数：${totalTray} 枚　
     総株数：${totalSeed.toLocaleString()} 株　
     予定面積合計：${totalAreaTan.toFixed(2)} 反`;

  tableArea.innerHTML = html;

  /* ▼ 播種日クリックでモーダル */
  document.querySelectorAll(".seed-date-cell").forEach(cell => {
    cell.addEventListener("click", () => {
      const ref = cell.dataset.id;
      const row = seedRows.find(s => s.seedRef === ref);
      const data = getSeedDetail(row);
      showInfoModal(data.title, data.html);
    });
  });

  /* ▼ 破棄ボタン */
  document.querySelectorAll(".discard-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const ref = btn.dataset.ref;
      location.href = `/seed/discard-seed.html?ref=${encodeURIComponent(ref)}`;
    });
  });
}
