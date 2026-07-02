// admin/edit-json/card-edit-machines.js
import { saveJSON } from "/common/json.js?v=1";
import { showSaveModal, completeSaveModal } from "/common/save-modal.js?v=1";

export function renderEditCard({ dataName, json, container }) {
  const title = document.getElementById("page-title");
  if (title) title.textContent = "機械（machines.json）";

  const machineList = Array.isArray(json?.machines) ? [...json.machines] : [];

  container.insertAdjacentHTML("beforeend", `
    <div class="card">
      <h2>機械一覧</h2>
      <div id="machine-list"></div>

      <button id="add-machine-btn" class="primary-btn" style="margin-top:20px;">
        ＋ 機械を追加
      </button>

      <button id="save-btn" class="primary-btn" style="margin-top:20px;">
        保存する
      </button>
    </div>
  `);

  const listEl = document.getElementById("machine-list");

  function render() {
    listEl.innerHTML = "";

    machineList.forEach((item, index) => {
      const id = item.id ?? "";
      const name = item.name ?? "";

      listEl.insertAdjacentHTML("beforeend", `
        <div class="sub-card" style="margin-bottom:12px;">
          <div class="form-row">
            <label class="form-label">ID</label>
            <input class="form-input machine-id" data-index="${index}" value="${escapeHtml(id)}">
          </div>

          <div class="form-row">
            <label class="form-label">名称</label>
            <input class="form-input machine-name" data-index="${index}" value="${escapeHtml(name)}">
          </div>

          <button class="secondary-btn delete-machine-btn" data-index="${index}" style="margin-top:8px;">
            削除
          </button>
        </div>
      `);
    });

    document.querySelectorAll(".delete-machine-btn").forEach(btn => {
      btn.onclick = () => {
        const idx = Number(btn.dataset.index);
        if (!confirm("この機械を削除しますか？")) return;
        machineList.splice(idx, 1);
        render();
      };
    });
  }

  render();

  document.getElementById("add-machine-btn").onclick = () => {
    machineList.push({
      id: "",
      name: ""
    });
    render();
  };

  document.getElementById("save-btn").onclick = async () => {
    showSaveModal("保存しています…");

    const ids = container.querySelectorAll(".machine-id");
    const names = container.querySelectorAll(".machine-name");

    const newMachines = [];

    ids.forEach((input, i) => {
      const id = input.value.trim();
      const name = names[i].value.trim();

      if (!id && !name) return;

      newMachines.push({ id, name });
    });

    const savePath = `data/${dataName}.json`;
    await saveJSON(savePath, { machines: newMachines });

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
