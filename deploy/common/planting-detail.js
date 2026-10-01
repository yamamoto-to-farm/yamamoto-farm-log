// common/planting-detail.js
// 定植記録の詳細モーダルを共通化（定植一覧・播種一覧など複数ページから同じ内容を表示するため）
import { loadCSV, normalizeKeys } from "/common/csv.js?v=20260821-quote-fix";
import { showInfoModal } from "/common/showInfoModal.js";

let plantingRowsCache = null;
let discardMapCache = null;
let seedRowsCache = null;
let loadingPromise = null;

async function ensureLoaded() {
  if (plantingRowsCache && discardMapCache) return;
  if (!loadingPromise) {
    loadingPromise = Promise.all([
      loadCSV("/logs/planting/all.csv").catch(() => []),
      loadCSV("/logs/discard-planting/all.csv").catch(() => []),
      loadCSV("/logs/seed/all.csv").catch(() => [])
    ]).then(([plantingRaw, discardRaw, seedRaw]) => {
      plantingRowsCache = normalizeKeys(plantingRaw || []);
      discardMapCache = buildDiscardQuantityMap(normalizeKeys(discardRaw || []));
      seedRowsCache = normalizeKeys(seedRaw || []);
    });
  }
  await loadingPromise;
}

function buildDiscardQuantityMap(discardRows) {
  const map = {};
  discardRows.forEach(row => {
    const ref = String(row?.plantingRef || "").trim();
    if (!ref) return;
    const qty = Number(row?.discardQuantity || row?.discard || 0);
    if (!Number.isFinite(qty) || qty === 0) return;
    map[ref] = (map[ref] || 0) + qty;
  });
  return map;
}

export async function getPlantingDetail(plantingRef) {
  await ensureLoaded();
  const row = plantingRowsCache.find(r => r.plantingRef === plantingRef);
  if (!row) {
    return { title: "データなし", html: "<p>該当データがありません。</p>" };
  }

  const discarded = Number(discardMapCache[plantingRef] || 0);
  const remaining = Math.max(0, Number(row.quantity || 0) - discarded);
  const seedRefs = String(row.seedRef || "").split(/[\/,]/).map(ref => ref.trim()).filter(Boolean);
  const seedDates = seedRefs
    .map(ref => seedRowsCache.find(seed => String(seed.seedRef || "").replace(/\s+/g, "") === ref.replace(/\s+/g, ""))?.seedDate)
    .filter(Boolean);
  const uniqueSeedDates = [...new Set(seedDates)];
  const escapeHtml = value => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");

  return {
    title: `定植情報：${plantingRef}`,
    html: `
      <p><b>圃場：</b>${escapeHtml(row.field)}</p>
      <p><b>品種：</b>${escapeHtml(row.variety)}</p>
      <p><b>定植日：</b>${escapeHtml(row.plantDate)}</p>
      <p><b>株数：</b>${escapeHtml(row.quantity)}</p>
      ${discarded ? `<p><b>破棄株数：</b>${discarded.toLocaleString()}（残 ${remaining.toLocaleString()} 株）</p>` : ""}
      <p><b>株間：</b>${escapeHtml(row.spacingRow)} cm</p>
      <p><b>畝間：</b>${escapeHtml(row.spacingBed)} cm</p>
      <p><b>トレイ種別：</b>${escapeHtml(row.trayType)}</p>
      <p><b>収穫予定：</b>${escapeHtml(row.harvestPlanYM)}</p>
      <p><b>播種日：</b>${uniqueSeedDates.length ? uniqueSeedDates.map(escapeHtml).join("、") : "未登録"}</p>
      <p><b>作業者：</b>${escapeHtml(row.worker)}</p>
      <p><b>機械：</b>${escapeHtml(row.machine)}</p>
      <p><b>メモ：</b><br>${escapeHtml(row.notes)}</p>
    `
  };
}

// plantingRefOrList: 単一の plantingRef、または複数まとめて切り替え表示したい場合は配列を渡す
export async function showPlantingDetailModal(plantingRefOrList, { canDiscard = false, index = 0 } = {}) {
  const refs = Array.isArray(plantingRefOrList) ? plantingRefOrList : [plantingRefOrList];
  const safeIndex = Math.min(Math.max(index, 0), Math.max(refs.length - 1, 0));
  const currentRef = refs[safeIndex];

  const data = await getPlantingDetail(currentRef);

  const navHtml = refs.length > 1
    ? `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-top:12px;">
        <button class="secondary-btn" id="planting-modal-prev" type="button" ${safeIndex === 0 ? "disabled" : ""}>← 前へ</button>
        <span>${safeIndex + 1} / ${refs.length}</span>
        <button class="secondary-btn" id="planting-modal-next" type="button" ${safeIndex === refs.length - 1 ? "disabled" : ""}>次へ →</button>
      </div>
    `
    : "";

  const discardActionHtml = canDiscard && currentRef
    ? `<div style="display:flex; flex-wrap:wrap; gap:8px; margin-top:12px;"><button class="secondary-btn" id="planting-modal-discard-btn" type="button">破棄ページへ</button><a class="secondary-btn" href="/admin/edit-csv/index.html?type=planting&file=all.csv&search=${encodeURIComponent(currentRef)}">CSVを編集</a></div>`
    : "";

  showInfoModal(data.title, `${data.html}${navHtml}${discardActionHtml}`);

  if (refs.length > 1) {
    document.getElementById("planting-modal-prev")?.addEventListener("click", () => {
      showPlantingDetailModal(refs, { canDiscard, index: safeIndex - 1 });
    });
    document.getElementById("planting-modal-next")?.addEventListener("click", () => {
      showPlantingDetailModal(refs, { canDiscard, index: safeIndex + 1 });
    });
  }

  if (canDiscard && currentRef) {
    const discardBtn = document.getElementById("planting-modal-discard-btn");
    if (discardBtn) {
      discardBtn.addEventListener("click", () => {
        location.href = `/planting/discard-planting.html?ref=${encodeURIComponent(currentRef)}&return=${encodeURIComponent(location.pathname + location.search)}`;
      });
    }
  }
}
