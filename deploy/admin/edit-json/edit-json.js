// admin/edit-json/edit-json.js
import { loadJSON } from "/common/json.js?v=2026031418";

export async function initEditJson() {

  const params = new URLSearchParams(location.search);

  const dataName = params.get("data");      // fields / field-detail / fertilizer-index など
  const fieldName = params.get("field");    // 圃場名
  const variety = params.get("variety");    // 品種名

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

  // ① デフォルト：/data/${dataName}.json
  let path = `/data/${dataName}.json`;

  // ② フォルダ構造版：/data/${dataName}/${dataName}.json
  const altPath = `/data/${dataName}/${dataName}.json`;

  // ③ HEAD で存在チェック（CloudFront は 404 でも reject しない）
  let finalPath = path;
  try {
    const head = await fetch(path, { method: "HEAD" });
    if (!head.ok) {
      // デフォルトが無ければフォルダ構造版に切り替え
      finalPath = altPath;
    }
  } catch {
    // fetch 自体が失敗した場合もフォルダ構造版へ
    finalPath = altPath;
  }

  // ④ JSON 読み込み
  const json = await loadJSON(finalPath);

  // ⑤ 編集カード読み込み
  const module = await import(`./card-edit-${dataName}.js`);

  // ⑥ 編集カードへ渡す
  module.renderEditCard({
    dataName,
    fieldName,
    variety,
    json,
    container,
    finalPath   // ★ 保存時に使うため渡す
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
