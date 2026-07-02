// admin/edit-json/card-edit-pesticide-index.js
import { saveJSON } from "/common/json.js?v=1";
import { showSaveModal, completeSaveModal } from "/common/save-modal.js?v=1";

export function renderEditCard({ json, container, finalPath }) {
  const title = document.getElementById("page-title");
  if (title) title.textContent = "農薬基本情報（pesticide-index.json）";

  let listData = Array.isArray(json)
    ? json
    : Object.values(json || {});

  container.insertAdjacentHTML("beforeend", `
    <div class="card">
      <h2>農薬一覧</h2>
      <div id="pesticide-list"></div>

      <button id="add-pesticide-btn" class="primary-btn" style="margin-top:20px;">
        ＋ 農薬を追加
      </button>

      <button id="save-btn" class="primary-btn" style="margin-top:20px;">
        保存する
      </button>
    </div>
  `);

  const listEl = document.getElementById("pesticide-list");

  function render() {
    listEl.innerHTML = "";

    listData.forEach((item, index) => {
      const id = item.id ?? "";
      const name = item.name ?? "";
      const category = item.category ?? "";
      const unit = item.unit ?? "";

      listEl.insertAdjacentHTML("beforeend", `
        <div class="sub-card" style="margin-bottom:12px;">
          <div class="form-row">
            <label class="form-label">ID</label>
            <input class="form-input pesticide-id" data-index="${index}" value="${escapeHtml(id)}">
          </div>

          <div class="form-row">
            <label class="form-label">名称</label>
            <input class="form-input pesticide-name" data-index="${index}" value="${escapeHtml(name)}">
          </div>

          <div class="form-row">
            <label class="form-label">カテゴリ</label>
            <input class="form-input pesticide-category" data-index="${index}" value="${escapeHtml(category)}">
          </div>

          <div class="form-row">
            <label class="form-label">単位</label>
            <input class="form-input pesticide-unit" data-index="${index}" value="${escapeHtml(unit)}">
          </div>

          <button class="secondary-btn delete-pesticide-btn" data-index="${index}" style="margin-top:8px;">
            削除
          </button>
        </div>
      `);
    });

    document.querySelectorAll(".delete-pesticide-btn").forEach(btn => {
      btn.onclick = () => {
        const idx = Number(btn.dataset.index);
        if (!confirm("この農薬を削除しますか？")) return;
        listData.splice(idx, 1);
        render();
      };
    });
  }

  render();

  document.getElementById("add-pesticide-btn").onclick = () => {
    listData.push({
      id: "",
      name: "",
      category: "",
      unit: ""
    });
    render();
  };

  document.getElementById("save-btn").onclick = async () => {
    showSaveModal("保存しています…");

    const ids = container.querySelectorAll(".pesticide-id");
    const names = container.querySelectorAll(".pesticide-name");
    const categories = container.querySelectorAll(".pesticide-category");
    const units = container.querySelectorAll(".pesticide-unit");

    const newList = [];

    ids.forEach((input, i) => {
      const id = input.value.trim();
      const name = names[i].value.trim();
      const category = categories[i].value.trim();
      const unit = units[i].value.trim();

      if (!id && !name) return;

      newList.push({
        id,
        name,
        category,
        unit
      });
    });

    const savePath = "data/" + finalPath.replace(/^\/data\//, "");
    await saveJSON(savePath, newList);

    completeSaveModal("保存が完了しました");
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
