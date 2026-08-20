// ===============================
// seedList.js（播種ベース一覧）
// ===============================

import { loadCSV, normalizeKeys } from "/common/csv.js?v=20260820";
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
let nurseryRows = [];
let discardSeedRows = [];
let varietyData = [];
let fieldData = [];
let canDiscard = false;

let filterData = {};
let initialized = false;
let seedDateSortOrder = null; // null | asc | desc
let seedDebugInfo = {
  loadedAt: "",
  files: []
};

const DEBUG_THRESHOLD_DATE = "2026-07-16";

/* ============================================================
   外部から呼ばれるエントリポイント
============================================================ */
export async function renderSeedList() {
  try {
    if (!initialized) {
      await initSeedListPage();
      initialized = true;
    }
  } catch (e) {
    console.error("[seedList] 初期化失敗:", e);
    const tableArea = document.getElementById("table-area");
    if (tableArea) {
      tableArea.innerHTML = `<div class="card"><p>播種ログを読み込めませんでした。</p><p>${String(e?.message || e)}</p></div>`;
    }
    return;
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

  seedDebugInfo = {
    loadedAt: new Date().toLocaleString("ja-JP"),
    files: []
  };

  seedRows = await loadSeedCsvDebug("播種CSV", "/logs/seed/all.csv", ["seedDate"]);
  plantingRows = await loadSeedCsvDebug("定植CSV", "/logs/planting/all.csv", ["plantDate"]);
  nurseryRows = await loadSeedCsvDebug("育苗CSV", "/logs/nursery/all.csv", ["date", "nurseryDate"], { optional: true });
  discardSeedRows = await loadSeedCsvDebug("播種破棄CSV", "/logs/discard-seed/all.csv", ["discardDate"], { optional: true });
  fieldData = await loadSeedJsonDebug("圃場JSON", "/data/fields.json");
  varietyData = await loadSeedJsonDebug("品種JSON", "/data/varieties.json");

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

  applyDefaultSeasonFilterIfNeeded(ymMap);
}

async function loadSeedCsvDebug(label, path, dateFields = [], options = {}) {
  const startedAt = performance.now();
  try {
    const rows = normalizeKeys(await loadCSV(path));
    seedDebugInfo.files.push({
      label,
      path,
      status: "OK",
      rows: rows.length,
      ms: Math.round(performance.now() - startedAt),
      ...getDateRangeInfo(rows, dateFields)
    });
    return rows;
  } catch (e) {
    seedDebugInfo.files.push({
      label,
      path,
      status: options.optional ? "SKIP" : "ERROR",
      rows: 0,
      ms: Math.round(performance.now() - startedAt),
      error: String(e?.message || e)
    });
    if (options.optional) return [];
    throw e;
  }
}

async function loadSeedJsonDebug(label, path) {
  const startedAt = performance.now();
  const data = await loadJSON(path);
  const rows = Array.isArray(data) ? data.length : Object.keys(data || {}).length;
  seedDebugInfo.files.push({
    label,
    path,
    status: "OK",
    rows,
    ms: Math.round(performance.now() - startedAt)
  });
  return data;
}

function getDateRangeInfo(rows, dateFields = []) {
  const dates = [];
  (Array.isArray(rows) ? rows : []).forEach(row => {
    for (const field of dateFields) {
      const value = String(row?.[field] || "").trim();
      if (value) {
        dates.push(value);
        break;
      }
    }
  });
  dates.sort();
  return {
    minDate: dates[0] || "",
    maxDate: dates[dates.length - 1] || ""
  };
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

  window.currentFilterState = {
    ...(window.currentFilterState || {}),
    yearMonths: [...matched],
    fields: [],
    varieties: []
  };

  setFilterState({ yearMonths: matched, fields: [], varieties: [] }, { apply: true });
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
  const refs = parseSeedRefs(seedRef);

  const plantingRefs = [];

  plantingRows.forEach(r => {
    if (!r.seedRef) return;
    const srefs = parseSeedRefs(r.seedRef);
    if (srefs.some(s => refs.includes(s))) {
      plantingRefs.push(r.plantingRef);
    }
  });

  return plantingRefs;
}

function normalizeRef(value) {
  return String(value ?? "").replace(/\s+/g, "").trim();
}

function parseSeedRefs(value) {
  return String(value ?? "")
    .split(/[\/,]/)
    .map(normalizeRef)
    .filter(Boolean);
}

function buildSeedUsageMap() {
  const plantedMap = {};
  const discardMap = {};

  plantingRows.forEach(row => {
    const qty = Number(row.quantity || 0);
    if (!Number.isFinite(qty) || qty === 0) return;

    parseSeedRefs(row.seedRef).forEach(ref => {
      plantedMap[ref] = (plantedMap[ref] || 0) + qty;
    });
  });

  nurseryRows.forEach(row => {
    const ref = normalizeRef(row.seedRef);
    if (!ref) return;

    const discard = Number(row.discard || 0);
    if (!Number.isFinite(discard) || discard === 0) return;

    discardMap[ref] = (discardMap[ref] || 0) + discard;
  });

  discardSeedRows.forEach(row => {
    const ref = normalizeRef(row.seedRef);
    if (!ref) return;

    let discard = Number(row.discardQuantity || 0);
    if (!Number.isFinite(discard) || discard <= 0) {
      const trays = Number(row.discardTrays || 0);
      const trayType = Number(row.trayType || 0);
      discard = Number.isFinite(trays) && Number.isFinite(trayType) ? trays * trayType : 0;
    }
    if (!Number.isFinite(discard) || discard === 0) return;

    discardMap[ref] = (discardMap[ref] || 0) + discard;
  });

  return { plantedMap, discardMap };
}

function formatCount(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return "0";
  const rounded = Math.round(num * 10) / 10;
  if (Math.abs(rounded - Math.round(rounded)) < 1e-9) {
    return Math.round(rounded).toLocaleString();
  }
  return rounded.toLocaleString();
}

function formatTrayCount(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return "-";

  const rounded = Math.round(num * 10) / 10;
  if (Math.abs(rounded - Math.round(rounded)) < 1e-9) {
    return `${Math.round(rounded).toLocaleString()}枚`;
  }
  return `${rounded.toLocaleString()}枚`;
}

function formatTrayWithType(trayCount, trayType) {
  const trayText = formatTrayCount(trayCount);
  const typeNum = Number(trayType || 0);
  if (Number.isFinite(typeNum) && typeNum > 0) {
    return `${trayText}（${Math.round(typeNum)}穴）`;
  }
  return trayText;
}

function resolveTrayUnit(seedRow) {
  const trayType = Number(seedRow?.trayType || 0);
  if (Number.isFinite(trayType) && trayType > 0) return trayType;

  const seedCount = Number(seedRow?.seedCount || 0);
  const trayCount = Number(seedRow?.trayCount || 0);
  if (Number.isFinite(seedCount) && Number.isFinite(trayCount) && seedCount > 0 && trayCount > 0) {
    return seedCount / trayCount;
  }

  return null;
}

function renderRemainingStockCell(seedRow, usageMap) {
  const seedRef = seedRow?.seedRef;
  const seedCount = Number(seedRow?.seedCount || 0);
  const ref = normalizeRef(seedRef);
  const planted = Number(usageMap.plantedMap[ref] || 0);
  const discarded = Number(usageMap.discardMap[ref] || 0);
  const total = Number(seedCount || 0);
  const remainingRaw = total - planted - discarded;
  const remaining = Math.max(0, remainingRaw);

  const trayUnit = resolveTrayUnit(seedRow);
  if (!trayUnit) {
    if (discarded > 0) {
      return `${formatCount(remaining)}<div style="font-size:12px;color:#6b7280;">破棄:${formatCount(discarded)}株</div>`;
    }
    return `${formatCount(remaining)}株`;
  }

  const remainingTrays = remaining / trayUnit;
  const discardedTrays = discarded / trayUnit;
  const trayType = Number(seedRow?.trayType || 0);

  if (discarded > 0) {
    return `${formatTrayWithType(remainingTrays, trayType)}<div style="font-size:12px;color:#6b7280;">破棄:${formatTrayWithType(discardedTrays, trayType)}</div>`;
  }
  return formatTrayWithType(remainingTrays, trayType);
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
  const sortedRows = sortRowsByDate(rows, "seedDate", seedDateSortOrder);
  const state = window.currentFilterState || {};

  let html = `
    <table>
      <thead>
        <tr>
          <th id="th-seed-date">${buildSeedDateHeaderLabel()}</th>
          <th>品種</th>
          <th>枚数</th>
          <th id="th-area">予定面積(反)</th>
          <th>残トレイ枚数</th>
          <th>定植ID</th>
        </tr>
      </thead>
      <tbody>
  `;

  let totalTray128 = 0;
  let totalTray200 = 0;
  let totalSeed = 0;
  let totalAreaTan = 0;
  const usageMap = buildSeedUsageMap();

  sortedRows.forEach(r => {

    const tray = Number(r.trayCount || 0);
    const seedCount = Number(r.seedCount || 0);
    const trayType = Number(r.trayType || 0);
    const areaTan = calcSeedAreaTan(seedCount);

    if (trayType === 128) totalTray128 += tray;
    if (trayType === 200) totalTray200 += tray;
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

      <td>${formatTrayWithType(tray, trayType)}</td>
      <td>${areaTan.toFixed(2)}</td>
      <td>${renderRemainingStockCell(r, usageMap)}</td>
      <td>${plantingHtml}</td>
    </tr>`;
  });

  html += `
      </tbody>
    </table>
  `;

  document.getElementById("countArea").textContent = `${rows.length} 件`;
  document.getElementById("summaryArea").innerHTML =
    `総枚数：${formatTrayWithType(totalTray128, 128)}<br>
     総枚数：${formatTrayWithType(totalTray200, 200)}<br>
     総株数：${totalSeed.toLocaleString()} 株<br>
     予定面積合計：${totalAreaTan.toFixed(2)} 反`;

  window.dispatchEvent(new CustomEvent("list:summary-updated"));

  tableArea.innerHTML = `${buildSeedDebugPanel(rows, state)}${html}`;

  const dateHeader = document.getElementById("th-seed-date");
  if (dateHeader) {
    dateHeader.style.cursor = "pointer";
    dateHeader.title = "クリックで昇順/降順を切り替え";
    dateHeader.addEventListener("click", () => {
      seedDateSortOrder = seedDateSortOrder === "asc" ? "desc" : "asc";
      renderTable(rows);
    });
  }

  /* ▼ 播種日クリックでモーダル */
  document.querySelectorAll(".seed-date-cell").forEach(cell => {
    cell.addEventListener("click", () => {
      const ref = cell.dataset.id;
      const row = seedRows.find(s => s.seedRef === ref);
      const data = getSeedDetail(row);

      const discardActionHtml = canDiscard && ref
        ? `<div style="margin-top:12px;"><button class="secondary-btn" id="seed-modal-discard-btn" type="button">破棄ページへ</button></div>`
        : "";

      showInfoModal(data.title, `${data.html}${discardActionHtml}`);

      if (canDiscard && ref) {
        const discardBtn = document.getElementById("seed-modal-discard-btn");
        if (discardBtn) {
          discardBtn.addEventListener("click", () => {
            location.href = `/seed/discard-seed.html?ref=${encodeURIComponent(ref)}`;
          });
        }
      }
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

}

function buildSeedDebugPanel(filteredRows, state) {
  const rawAfterThreshold = seedRows.filter(r => String(r.seedDate || "") > DEBUG_THRESHOLD_DATE);
  const filteredAfterThreshold = (Array.isArray(filteredRows) ? filteredRows : [])
    .filter(r => String(r.seedDate || "") > DEBUG_THRESHOLD_DATE);
  const latestRows = seedRows
    .slice()
    .sort((a, b) => String(b.seedDate || "").localeCompare(String(a.seedDate || "")))
    .slice(0, 8);
  const selectedYearMonths = Array.isArray(state.yearMonths) ? state.yearMonths : [];
  const hasHiddenLaterRows = rawAfterThreshold.length > 0 && filteredAfterThreshold.length === 0;

  return `
    <details class="card" style="margin:0 0 12px; font-size:13px;" open>
      <summary style="cursor:pointer; font-weight:bold; color:#064e3b;">播種一覧デバッグ</summary>
      <div style="margin-top:8px; line-height:1.7;">
        <div>読込時刻: ${escapeHtml(seedDebugInfo.loadedAt || "-")}</div>
        <div>現在フィルタ: 年月=${escapeHtml(selectedYearMonths.join(" / ") || "なし")} / 圃場=${escapeHtml((state.fields || []).join(" / ") || "なし")} / 品種=${escapeHtml((state.varieties || []).join(" / ") || "なし")}</div>
        <div>播種CSV: 全${seedRows.length}件 / 表示${filteredRows.length}件 / ${DEBUG_THRESHOLD_DATE}より後: 全${rawAfterThreshold.length}件・表示${filteredAfterThreshold.length}件</div>
        ${hasHiddenLaterRows ? `<div style="color:#b45309; font-weight:bold;">${DEBUG_THRESHOLD_DATE}より後の播種は読み込めていますが、現在のフィルタで除外されています。</div>` : ""}
        <table style="margin-top:8px; width:100%; font-size:12px;">
          <thead><tr><th>種別</th><th>読込パス</th><th>状態</th><th>件数</th><th>日付範囲</th><th>ms</th></tr></thead>
          <tbody>
            ${seedDebugInfo.files.map(file => `
              <tr>
                <td>${escapeHtml(file.label)}</td>
                <td>${escapeHtml(file.path)}</td>
                <td>${escapeHtml(file.status)}${file.error ? `<br>${escapeHtml(file.error)}` : ""}</td>
                <td>${escapeHtml(file.rows)}</td>
                <td>${escapeHtml([file.minDate, file.maxDate].filter(Boolean).join(" - ") || "-")}</td>
                <td>${escapeHtml(file.ms)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
        <div style="margin-top:8px;">最新日付側サンプル: ${latestRows.map(r => `${escapeHtml(r.seedDate)} ${escapeHtml(r.varietyName)} ${escapeHtml(r.seedRef)}`).join(" / ") || "-"}</div>
      </div>
    </details>
  `;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildSeedDateHeaderLabel() {
  if (seedDateSortOrder === "asc") return "播種日 ▲";
  if (seedDateSortOrder === "desc") return "播種日 ▼";
  return "播種日";
}

function sortRowsByDate(rows, key, order) {
  const list = Array.isArray(rows) ? rows.slice() : [];
  if (!order) return list;

  const factor = order === "asc" ? 1 : -1;
  return list.sort((a, b) => {
    const av = dateToSortableNumber(a?.[key]);
    const bv = dateToSortableNumber(b?.[key]);
    return (av - bv) * factor;
  });
}

function dateToSortableNumber(value) {
  const text = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return -1;
  return Number(text.replace(/-/g, ""));
}
