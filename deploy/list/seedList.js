// ===============================
// seedList.js（播種ベース一覧）
// ===============================

import { loadCSV, normalizeKeys } from "/common/csv.js";
import { loadJSON } from "/common/json.js";
import { calcAreaM2, calcAreaTan } from "/fields/analysis-utils.js";

import {
  openYearModal,
  openFieldModal,
  openVarietyModal,
  setFilterData,
  getFilterState,
  setFilterState
} from "/common/filter.js";

import { showInfoModal } from "/common/showInfoModal.js";

let seedRows = [];
let plantingRows = [];
let varietyData = [];
let fieldData = [];
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
  fieldData = await loadJSON("/data/fields.json");
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

  const areaMap = {};
  const areaOrder = [];
  (Array.isArray(fieldData) ? fieldData : []).forEach(f => {
    const area = String(f?.area || "").trim() || "未分類";
    const name = String(f?.name || "").trim();
    if (!name) return;
    if (!areaMap[area]) {
      areaMap[area] = [];
      areaOrder.push(area);
    }
    areaMap[area].push(name);
  });

  filterData = {
    years: Object.keys(ymMap).sort(),
    months: ymMap,
    fields: { parents: areaOrder, children: areaMap },
    varieties: { parents: typeOrder, children: typeMap }
  };

  // ▼ フィルタ UI 初期化
  setFilterData(filterData);

  applyDefaultSeasonFilterIfNeeded(ymMap);

  // ▼ list.js がモード切替時に再適用できるよう保存
  window.seedFilterData = filterData;

  document.querySelector('[data-type="year"]').addEventListener("click", openYearModal);
  document.querySelector('[data-type="field"]').addEventListener("click", openFieldModal);
  document.querySelector('[data-type="variety"]').addEventListener("click", openVarietyModal);

  /* ============================================================
     ★ フィルタ適用時：seed モードのときだけ動く
  ============================================================ */
  window.addEventListener("filter:apply", (e) => {
    if (window.currentListMode !== "seed") return;  // ← これが重要
    window.currentFilterState = e.detail;
    renderTable(applyAllFilters(seedRows, e.detail));
  });

  window.addEventListener("filter:reset", () => {
    if (window.currentListMode !== "seed") return;  // ← これが重要
    window.currentFilterState = {};
    renderTable(seedRows);
  });
}

function applyDefaultSeasonFilterIfNeeded(ymMap) {
  const current = getFilterState();
  const alreadySelected =
    current.yearMonths.length > 0 ||
    current.fields.length > 0 ||
    current.varieties.length > 0;
  if (alreadySelected) return;

  const now = new Date();
  const baseYear = now.getFullYear();

  const targets = [];
  for (let m = 7; m <= 12; m += 1) {
    targets.push(`${baseYear}-${String(m).padStart(2, "0")}`);
  }
  for (let m = 1; m <= 3; m += 1) {
    targets.push(`${baseYear + 1}-${String(m).padStart(2, "0")}`);
  }

  const available = new Set(
    Object.entries(ymMap || {}).flatMap(([year, months]) =>
      (months || []).map(month => `${year}-${month}`)
    )
  );

  const matched = targets.filter(ym => available.has(ym));
  if (!matched.length) return;

  setFilterState({ yearMonths: matched }, { apply: true });
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
    `
  };
}

/* ============================================================
   予定面積(反)
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
          <th id="th-area">予定面積(反)</th>
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

      <td>
        <a href="/varieties/index.html?variety=${encodeURIComponent(r.varietyName)}">
          ${r.varietyName ?? ""}
        </a>
      </td>

      <td>${tray}</td>
      <td>${areaTan.toFixed(2)}</td>
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

  /* ▼ 予定面積(反) ヘッダークリックで説明モーダル */
  document.getElementById("th-area").addEventListener("click", () => {
    showInfoModal(
      "予定面積の計算基準",
      `
        <p><b>予定面積は以下の基準で計算しています：</b></p>
        <p>株間：34cm / 畝間：60cm</p>
        <p>※播種一覧では実績面積ではなく、播種株数から算出した予定面積を表示します。</p>
      `
    );
  });

  /* ▼ 破棄ボタン */
  document.querySelectorAll(".discard-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const ref = btn.dataset.ref;
      location.href = `/seed/discard-seed.html?ref=${encodeURIComponent(ref)}`;
    });
  });
}
