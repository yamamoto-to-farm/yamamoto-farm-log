// admin/edit-json/card-edit-fertilizer-index.js
import { saveJSON } from "/common/json.js?v=2026031418";
import { showSaveModal, completeSaveModal } from "/common/save-modal.js?v=2026031418";

export function renderEditCard({ dataName, json, container }) {

  const title = document.getElementById("page-title");
  if (title) title.textContent = "施肥ログインデックス（fertilizer-index.json）";

  container.insertAdjacentHTML("beforeend", `
    <div id="index-list"></div>

    <button id="add-field-btn" class="primary-btn" style="margin-top:20px;">
      ＋ 圃場を追加
    </button>

    <button id="save-btn" class="primary-btn" style="margin-top:20px;">
      保存する
    </button>
  `);

  const list = document.getElementById("index-list");

  // -----------------------------
  // レンダリング
  // -----------------------------
  function render() {
    list.innerHTML = "";

    for (const field in json) {
      const years = json[field];

      list.insertAdjacentHTML("beforeend", `
        <div class="card" style="margin-bottom:20px;">
          <h3>${field}</h3>

          <div id="years-${field}"></div>

          <button class="secondary-btn add-year-btn" data-field="${field}">
            ＋ 年度を追加
          </button>
        </div>
      `);

      const yBox = document.getElementById(`years-${field}`);

      for (const year in years) {
        yBox.insertAdjacentHTML("beforeend", `
          <div class="sub-card" style="margin-bottom:10px;">
            <h4>${year}</h4>
            <textarea class="form-input" data-field="${field}" data-year="${year}" rows="3">${years[year].join("\n")}</textarea>
          </div>
        `);
      }
    }

    // 年度追加ボタン
    document.querySelectorAll(".add-year-btn").forEach(btn => {
      btn.onclick = () => {
        const field = btn.dataset.field;
        const newYear = prompt("追加する年度を入力（例：2026）");

        if (!newYear) return;

        if (!json[field][newYear]) {
          json[field][newYear] = [];
          render();
        } else {
          alert("その年度はすでに存在します");
        }
      };
    });
  }

  render();

  // -----------------------------
  // 圃場追加
  // -----------------------------
  document.getElementById("add-field-btn").onclick = () => {
    const newField = prompt("追加する圃場名を入力してください");

    if (!newField) return;

    if (json[newField]) {
      alert("その圃場はすでに存在します");
      return;
    }

    json[newField] = {};
    render();
  };

  // -----------------------------
  // 保存処理
  // -----------------------------
  document.getElementById("save-btn").onclick = async () => {

    showSaveModal("保存しています…");

    const areas = container.querySelectorAll("textarea[data-field]");

    areas.forEach(el => {
      const field = el.dataset.field;
      const year = el.dataset.year;

      const lines = el.value
        .split("\n")
        .map(s => s.trim())
        .filter(s => s);

      json[field][year] = lines;
    });

    await saveJSON(`data/${dataName}.json`, json);

    completeSaveModal("保存が完了しました");
  };
}
