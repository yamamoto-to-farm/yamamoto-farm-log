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

  // ★ タイトル変更（field-detail と同じ）
  const title = document.getElementById("page-title");
  if (title) {
    title.textContent = `品種データ編集（${variety}）`;
  }

  // ★ データ取得（なければテンプレート）
  const TEMPLATE = json["TEMPLATE_VARIETY"] || {
    growthDays: "",
    yieldPer10a: "",
    memo: ""
  };

  const data = json[variety] ? json[variety] : { ...TEMPLATE };

  // ============================
  // 基本情報カード
  // ============================
  container.insertAdjacentHTML("beforeend", `
    <div class="card">
      <h2>基本情報</h2>

      <div class="edit-line">
        <label>生育日数（日）</label>
        <input id="growthDays" type="number" value="${data.growthDays || ""}">
      </div>

      <div class="edit-line">
        <label>反収（kg/10a）</label>
        <input id="yieldPer10a" type="number" value="${data.yieldPer10a || ""}">
      </div>

      <div class="edit-line">
        <label>メモ</label>
        <textarea id="memo" rows="4">${data.memo || ""}</textarea>
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
   保存処理（全文更新＋保存モーダル）
============================ */
async function saveVarietyDetail(dataName, variety) {

  const newData = {
    growthDays: Number(document.getElementById("growthDays").value) || "",
    yieldPer10a: Number(document.getElementById("yieldPer10a").value) || "",
    memo: document.getElementById("memo").value || ""
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
