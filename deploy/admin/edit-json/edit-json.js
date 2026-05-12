// admin/edit-json/edit-json.js
import { loadJSON } from "/common/json.js?v=2026031418";

export async function initEditJson() {

  const params = new URLSearchParams(location.search);

  // ★ URL パラメータ取得（field-detail / variety-detail 両対応）
  const dataName = params.get("data");      // field-detail / variety-detail
  const fieldName = params.get("field");    // 圃場名
  const variety = params.get("variety");    // 品種名 ← 追加

  const container = document.getElementById("edit-container");
  container.innerHTML = "";   // ★ 二重描画防止

  // -----------------------------
  // ハブページ（data パラメータなし）
  // -----------------------------
  if (!dataName) {
    renderJsonList(container);
    return;
  }

  // -----------------------------
  // 編集ページ
  // -----------------------------
  const json = await loadJSON(`/data/${dataName}.json`);

  // ★ dataName に応じて card-edit-◯◯ を読み込む
  const module = await import(`./card-edit-${dataName}.js`);

  // ★ fieldName と variety の両方を渡す（どちらか片方を使う）
  module.renderEditCard({
    dataName,
    fieldName,
    variety,
    json,
    container
  });
}


// -----------------------------
// JSON 一覧（ハブページ）
// -----------------------------
function renderJsonList(container) {

  container.insertAdjacentHTML("beforeend", `
    <div class="card">
      <h2>圃場基本情報（fields.json）</h2>
      <button class="primary-btn"
        onclick="location.href='?data=fields'">
        編集する
      </button>
    </div> 
    
    <div class="card">
      <h2>圃場詳細（field-detail.json）</h2>
      <button class="primary-btn"
        onclick="location.href='?data=field-detail'">
        編集する
      </button>
    </div>

    <div class="card">
      <h2>品種基本情報（varieties.json）</h2>
      <button class="primary-btn"
        onclick="location.href='?data=varieties'">
        編集する
      </button>
    </div>

    <div class="card">
      <h2>品種詳細情報（variety-detail.json）</h2>
      <button class="primary-btn"
        onclick="location.href='?data=variety-detail'">
        編集する
      </button>
    </div>

    <div class="card">
      <h2>肥料基本情報（fertilizer-index.json）</h2>
      <button class="primary-btn"
        onclick="location.href='?data=fertilizer-index'">
        編集する
      </button>
    </div>

    <div class="card">
      <h2>肥料詳細情報（fertilizer-detail.json）</h2>
      <button class="primary-btn"
        onclick="location.href='?data=fertilizer-detail'">
        編集する
      </button>
    </div>

    <div class="card">
      <h2>アクセス権限（workers.json）</h2>
      <button class="primary-btn"
        onclick="location.href='?data=workers'">
        編集する
      </button>
    </div>

    <div class="card">
      <h2>機械（machines.json）</h2>
      <button class="primary-btn"
        onclick="location.href='?data=machines'">
        編集する
      </button>
    </div>

  `);
}
