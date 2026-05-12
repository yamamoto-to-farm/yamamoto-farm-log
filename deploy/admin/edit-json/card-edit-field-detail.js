// admin/edit-json/card-edit-fertilizer-detail.js
import { saveJSON } from "/common/json.js?v=2026031418";
import { showSaveModal, completeSaveModal } from "/common/save-modal.js?v=2026031418";

export function renderEditCard({ dataName, json, container }) {

  // タイトル
  const title = document.getElementById("page-title");
  if (title) title.textContent = "肥料詳細情報（fertilizer-detail.json）";

  container.insertAdjacentHTML("beforeend", `
    <div id="fertilizer-list"></div>

    <button id="add-fertilizer-btn" class="primary-btn" style="margin-top:20px;">
      ＋ 肥料を追加
    </button>

    <button id="save-btn" class="primary-btn" style="margin-top:20px;">
      保存する
    </button>
  `);

  const list = document.getElementById("fertilizer-list");

  // -----------------------------
  // レンダリング
  // -----------------------------
  function render() {
    list.innerHTML = "";

    for (const id in json) {
      const f = json[id];

      list.insertAdjacentHTML("beforeend", `
        <div class="card" style="margin-bottom:20px;">
          <h3>${id}</h3>

          <div class="edit-line">
            <label>名称</label>
            <input class="form-input" data-id="${id}" data-key="name" value="${f.name || ""}">
          </div>

          <div class="edit-line">
            <label>メーカー</label>
            <input class="form-input" data-id="${id}" data-key="maker" value="${f.maker || ""}">
          </div>

          <div class="edit-line">
            <label>N / P / K</label>
            <div style="display:flex; gap:10px;">
              <input class="form-input" data-id="${id}" data-key="n" type="number" value="${f.n || 0}">
              <input class="form-input" data-id="${id}" data-key="p" type="number" value="${f.p || 0}">
              <input class="form-input" data-id="${id}" data-key="k" type="number" value="${f.k || 0}">
            </div>
          </div>

          <div class="edit-line">
            <label>月別価格（YYYY-MM: 値）</label>
            <textarea class="form-input" data-id="${id}" data-key="price" rows="4">${JSON.stringify(f.price || {}, null, 2)}</textarea>
          </div>

          <div class="edit-line">
            <label>メモ</label>
            <textarea class="form-input" data-id="${id}" data-key="notes" rows="2">${f.notes || ""}</textarea>
          </div>
        </div>
      `);
    }
  }

  render();

  // -----------------------------
  // 肥料追加
  // -----------------------------
  document.getElementById("add-fertilizer-btn").onclick = () => {
    const newId = "F" + String(Object.keys(json).length + 1).padStart(3, "0");
    json[newId] = {
      name: "",
      maker: "",
      price: {},
      n: 0,
      p: 0,
      k: 0,
      notes: ""
    };
    render();
  };

  // -----------------------------
  // 保存処理
  // -----------------------------
  document.getElementById("save-btn").onclick = async () => {

    showSaveModal("保存しています…");

    const inputs = container.querySelectorAll("[data-id]");

    inputs.forEach(el => {
      const id = el.dataset.id;
      const key = el.dataset.key;
      let value = el.value;

      if (key === "n" || key === "p" || key === "k") {
        value = Number(value) || 0;
      }

      if (key === "price") {
        try {
          value = JSON.parse(value);
        } catch {
          alert("価格は JSON 形式で入力してください");
          return;
        }
      }

      json[id][key] = value;
    });

    // ★ 保存先を fertilizer フォルダに変更
    await saveJSON(`data/fertilizer/${dataName}.json`, json);

    completeSaveModal("保存が完了しました");
  };
}
