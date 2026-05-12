// admin/edit-json/edit-json.js
import { loadJSON } from "/common/json.js?v=1";

export async function initEditJson() {

  const params = new URLSearchParams(location.search);

  const dataName = params.get("data");
  const fieldName = params.get("field");
  const variety = params.get("variety");

  const container = document.getElementById("edit-container");
  container.innerHTML = "";

  // -----------------------------
  // ハブページ
  // -----------------------------
  if (!dataName) {
    renderJsonList(container);
    return;
  }

  // -----------------------------
  // 編集ページ
  // -----------------------------

  // ① /data/${dataName}.json
  const path1 = `/data/${dataName}.json`;

  // ② /data/${prefix}/${dataName}.json
  const prefix = dataName.split("-")[0];
  const path2 = `/data/${prefix}/${dataName}.json`;

  // ③ /data/${dataName}/${dataName}.json
  const path3 = `/data/${dataName}/${dataName}.json`;

  // チェック順
  const candidates = [path1, path2, path3];

  let finalPath = null;

  for (const p of candidates) {
    try {
      const head = await fetch(p, { method: "HEAD" });
      if (head.ok) {
        finalPath = p;
        break;
      }
    } catch {
      // 無視して次へ
    }
  }

  if (!finalPath) {
    alert("JSON ファイルが見つかりません: " + dataName);
    return;
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
    finalPath
  });
}


// -----------------------------
// JSON 一覧
// -----------------------------
function renderJsonList(container) {

  container.insertAdjacentHTML("beforeend", `
    <div class="card">
      <h2>圃場基本情報（fields.json）</h2>
      <button class="primary-btn" onclick="location.href='?data=fields'">編集する</button>
    </div>

    <div class="card">
      <h2>圃場詳細（field-detail.json）</h2>
      <button class="primary-btn" onclick="location.href='?data=field-detail'">編集する</button>
    </div>

    <div class="card">
      <h2>品種基本情報（varieties.json）</h2>
      <button class="primary-btn" onclick="location.href='?data=varieties'">編集する</button>
    </div>

    <div class="card">
      <h2>品種詳細情報（variety-detail.json）</h2>
      <button class="primary-btn" onclick="location.href='?data=variety-detail'">編集する</button>
    </div>

    <div class="card">
      <h2>肥料基本情報（fertilizer-index.json）</h2>
      <button class="primary-btn" onclick="location.href='?data=fertilizer-index'">編集する</button>
    </div>

    <div class="card">
      <h2>肥料詳細情報（fertilizer-detail.json）</h2>
      <button class="primary-btn" onclick="location.href='?data=fertilizer-detail'">編集する</button>
    </div>

    <div class="card">
      <h2>アクセス権限（workers.json）</h2>
      <button class="primary-btn" onclick="location.href='?data=workers'">編集する</button>
    </div>

    <div class="card">
      <h2>機械（machines.json）</h2>
      <button class="primary-btn" onclick="location.href='?data=machines'">編集する</button>
    </div>
  `);
}
