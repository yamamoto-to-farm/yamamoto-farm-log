// admin/edit-json/card-edit-variety-detail.js
import { loadJSON, saveJSON } from "/common/json.js?v=2026031418";
import { showSaveModal, completeSaveModal } from "/common/save-modal.js?v=2026031418";

export function renderEditCard({ dataName, variety, json, container }) {

  if (!variety) {
    container.innerHTML = `
      <div class="card">
        <div class="info-line">variety パラメータが必要です。</div>
      </div>`;
    return;
  }

  // ★ タイトル変更
  const title = document.getElementById("page-title");
  if (title) {
    title.textContent = `品種データ編集（${variety}）`;
  }

  // ★ データ取得（なければテンプレート）
  const TEMPLATE = json["TEMPLATE_VARIETY"];
  const data = json[variety] ? json[variety] : { ...TEMPLATE };

  // ============================
  // 基本情報カード
  // ============================
  container.insertAdjacentHTML("beforeend", `
    <div class="card">
      <h2>基本データ</h2>

      <div class="edit-line">
        <label>メーカー</label>
        <input id="maker" value="${data.maker}">
      </div>

      <div class="edit-line">
        <label>播種期</label>
        <input id="sowingPeriod" value="${data.sowingPeriod}">
      </div>

      <div class="edit-line">
        <label>収穫期</label>
        <input id="harvestPeriod" value="${data.harvestPeriod}">
      </div>

      <div class="edit-line">
        <label>適した土壌</label>
        <input id="bestGrowth" value="${data.bestGrowth}">
      </div>

      <div class="edit-line">
        <label>耐寒性</label>
        <input id="coldTolerance" value="${data.coldTolerance}">
      </div>

      <div class="edit-line">
        <label>特徴</label>
        <textarea id="features" rows="3">${data.features}</textarea>
      </div>

      <div class="edit-line">
        <label>メモ</label>
        <textarea id="memo" rows="4">${data.memo}</textarea>
      </div>
    </div>
  `);

  // ============================
  // 保存ボタン
  // ============================
  container.insertAdjacentHTML("beforeend", `
    <button id="save-btn" class="primary-btn" style="margin-top:20px;">
      保存する
    </button>
  `);

  document.getElementById("save-btn").addEventListener("click", () => {
    saveVarietyDetail(dataName, variety);
  });
}

/* ============================
   保存処理
============================ */
async function saveVarietyDetail(dataName, variety) {

  const newData = {
    maker: document.getElementById("maker").value,
    sowingPeriod: document.getElementById("sowingPeriod").value,
    harvestPeriod: document.getElementById("harvestPeriod").value,
    bestGrowth: document.getElementById("bestGrowth").value,
    coldTolerance: document.getElementById("coldTolerance").value,
    features: document.getElementById("features").value,
    memo: document.getElementById("memo").value
  };

  showSaveModal("保存しています…");

  const fileName = `${dataName}.json`;
  const current = await loadJSON(`/data/${fileName}`);

  current[variety] = newData;

  await saveJSON(`data/${fileName}`, current);

  completeSaveModal("保存が完了しました");

  setTimeout(() => {
    location.href = `/varieties/index.html?variety=${encodeURIComponent(variety)}`;
  }, 800);
}
