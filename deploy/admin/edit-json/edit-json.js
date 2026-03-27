// admin/edit-json/edit-json.js
import { loadJSON } from "/common/json.js?v=2026031418";

export async function initEditJson() {

  const params = new URLSearchParams(location.search);
  const dataName = params.get("data");
  const fieldName = params.get("field");

  const container = document.getElementById("edit-container");
  container.innerHTML = "";   // ★ 二重描画防止の最重要ポイント

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

  const module = await import(`./card-edit-${dataName}.js`);
  module.renderEditCard({
    dataName,
    fieldName,
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
      <h2>圃場基本情報（field-detail.json）</h2>
      <button class="primary-btn"
        onclick="location.href='?data=field-detail'">
        編集する
      </button>
    </div>

    <div class="card">
      <h2>アクセス権限（access.json）</h2>
      <button class="primary-btn"
        onclick="location.href='?data=access'">
        編集する
      </button>
    </div>
  `);
}