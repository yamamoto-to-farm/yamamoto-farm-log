// admin/edit-json/edit-json.js
import { loadJSON } from "/common/json.js";

export async function initEditJson() {
  const params = new URLSearchParams(location.search);
  const dataName = params.get("data");   // 例: field-detail
  const fieldName = params.get("field"); // 例: 赤沢(上)

  const title = document.getElementById("page-title");
  const subtitle = document.getElementById("page-subtitle");
  const container = document.getElementById("edit-container");

  // ============================================================
  // ① data パラメータが無い → ハブページとして JSON 一覧を表示
  // ============================================================
  if (!dataName) {
    title.textContent = "管理データ編集（JSON）";
    subtitle.textContent = "編集するデータを選択してください";

    renderJsonList(container);
    return;
  }

  // ============================================================
  // ② data パラメータがある → 個別編集ページ
  // ============================================================
  title.textContent = `管理データ編集（${dataName}.json）`;
  subtitle.textContent = fieldName ? `対象：${fieldName}` : "";

  let json;
  try {
    json = await loadJSON(`/data/${dataName}.json`);
  } catch (e) {
    console.error(e);
    container.innerHTML = `
      <div class="card">
        <div class="info-line">/data/${dataName}.json を読み込めませんでした。</div>
      </div>`;
    return;
  }

  // ============================================================
  // ③ card-edit-〇〇.js を動的 import
  // ============================================================
  try {
    const module = await import(`./card-edit-${dataName}.js`);

    if (typeof module.renderEditCard !== "function") {
      throw new Error(`card-edit-${dataName}.js に renderEditCard がありません`);
    }

    module.renderEditCard({
      dataName,
      fieldName,
      json,
      container,
    });

  } catch (e) {
    console.error(e);
    container.innerHTML = `
      <div class="card">
        <h2>未対応のデータ形式</h2>
        <div class="info-line">card-edit-${dataName}.js が見つからないか、エラーが発生しました。</div>
        <pre style="white-space:pre-wrap; font-size:12px;">${String(e)}</pre>
      </div>
    `;
  }
}

initEditJson();


// ============================================================
// ★ ハブページ：編集可能な JSON 一覧を表示
// ============================================================
function renderJsonList(container) {

  // 将来ここに追加するだけで OK
  const editableJsonFiles = [
    { id: "field-detail", label: "圃場基本情報（field-detail.json）" },
    { id: "access", label: "アクセス権限（access.json）" },
    // { id: "contracts", label: "契約情報（contracts.json）" }, ← 将来追加
  ];

  editableJsonFiles.forEach(item => {
    container.insertAdjacentHTML("beforeend", `
      <div class="card clickable"
           onclick="location.href='?data=${item.id}'">
        <h2>${item.label}</h2>
        <div class="info-line">編集する</div>
      </div>
    `);
  });
}