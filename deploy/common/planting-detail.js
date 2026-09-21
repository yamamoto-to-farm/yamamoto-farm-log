// common/planting-detail.js
// 定植記録の詳細モーダルを共通化（定植一覧・播種一覧など複数ページから同じ内容を表示するため）
import { loadCSV, normalizeKeys } from "/common/csv.js?v=20260821-quote-fix";
import { showInfoModal } from "/common/showInfoModal.js";

let plantingRowsCache = null;
let discardMapCache = null;
let loadingPromise = null;

async function ensureLoaded() {
  if (plantingRowsCache && discardMapCache) return;
  if (!loadingPromise) {
    loadingPromise = Promise.all([
      loadCSV("/logs/planting/all.csv").catch(() => []),
      loadCSV("/logs/discard-planting/all.csv").catch(() => [])
    ]).then(([plantingRaw, discardRaw]) => {
      plantingRowsCache = normalizeKeys(plantingRaw || []);
      discardMapCache = buildDiscardQuantityMap(normalizeKeys(discardRaw || []));
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

  return {
    title: `定植情報：${plantingRef}`,
    html: `
      <p><b>圃場：</b>${row.field ?? ""}</p>
      <p><b>品種：</b>${row.variety ?? ""}</p>
      <p><b>定植日：</b>${row.plantDate ?? ""}</p>
      <p><b>株数：</b>${row.quantity}</p>
      ${discarded ? `<p><b>破棄株数：</b>${discarded.toLocaleString()}（残 ${remaining.toLocaleString()} 株）</p>` : ""}
      <p><b>株間：</b>${row.spacingRow} cm</p>
      <p><b>畝間：</b>${row.spacingBed} cm</p>
      <p><b>トレイ種別：</b>${row.trayType}</p>
      <p><b>収穫予定：</b>${row.harvestPlanYM ?? ""}</p>
      <p><b>播種ID：</b>${row.seedRef}</p>
      <p><b>作業者：</b>${row.worker ?? ""}</p>
      <p><b>機械：</b>${row.machine ?? ""}</p>
      <p><b>メモ：</b><br>${row.notes ?? ""}</p>
    `
  };
}

export async function showPlantingDetailModal(plantingRef, { canDiscard = false } = {}) {
  const data = await getPlantingDetail(plantingRef);

  const discardActionHtml = canDiscard && plantingRef
    ? `<div style="display:flex; flex-wrap:wrap; gap:8px; margin-top:12px;"><button class="secondary-btn" id="planting-modal-discard-btn" type="button">破棄ページへ</button><a class="secondary-btn" href="/admin/edit-csv/index.html?type=planting&file=all.csv&search=${encodeURIComponent(plantingRef)}">CSVを編集</a></div>`
    : "";

  showInfoModal(data.title, `${data.html}${discardActionHtml}`);

  if (canDiscard && plantingRef) {
    const discardBtn = document.getElementById("planting-modal-discard-btn");
    if (discardBtn) {
      discardBtn.addEventListener("click", () => {
        location.href = `/planting/discard-planting.html?ref=${encodeURIComponent(plantingRef)}&return=${encodeURIComponent(location.pathname + location.search)}`;
      });
    }
  }
}
