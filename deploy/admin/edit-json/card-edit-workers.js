// admin/edit-json/card-edit-workers.js
import { saveJSON } from "/common/json.js?v=1";
import { bumpAuthVersion } from "/common/ui.js";
import { showSaveModal, completeSaveModal } from "/common/save-modal.js?v=1";

export function renderEditCard({ dataName, json, container }) {
  const title = document.getElementById("page-title");
  if (title) title.textContent = "アクセス権限（workers.json）";

  const workerList = Array.isArray(json) ? [...json] : Array.isArray(json?.workers) ? [...json.workers] : [];

  container.insertAdjacentHTML("beforeend", `
    <div class="card">
      <h2>作業者一覧</h2>
      <div id="worker-list"></div>

      <button id="add-worker-btn" class="primary-btn" style="margin-top:20px;">
        ＋ 作業者を追加
      </button>

      <button id="save-btn" class="primary-btn" style="margin-top:20px;">
        保存する
      </button>
    </div>
  `);

  const listEl = document.getElementById("worker-list");

  function render() {
    listEl.innerHTML = "";

    workerList.forEach((item, index) => {
      const pin = item.pin ?? "";
      const name = item.name ?? "";
      const display = item.display ?? "";
      const role = item.role ?? "worker";

      listEl.insertAdjacentHTML("beforeend", `
        <div class="sub-card" style="margin-bottom:12px;">
          <div class="form-row">
            <label class="form-label">PIN</label>
            <input class="form-input worker-pin" data-index="${index}" value="${escapeHtml(pin)}">
          </div>

          <div class="form-row">
            <label class="form-label">name</label>
            <input class="form-input worker-name" data-index="${index}" value="${escapeHtml(name)}">
          </div>

          <div class="form-row">
            <label class="form-label">表示名</label>
            <input class="form-input worker-display" data-index="${index}" value="${escapeHtml(display)}">
          </div>

          <div class="form-row">
            <label class="form-label">role</label>
            <select class="form-input worker-role" data-index="${index}">
              ${renderRoleOptions(role)}
            </select>
          </div>

          <button class="secondary-btn delete-worker-btn" data-index="${index}" style="margin-top:8px;">
            削除
          </button>
        </div>
      `);
    });

    document.querySelectorAll(".delete-worker-btn").forEach(btn => {
      btn.onclick = () => {
        const idx = Number(btn.dataset.index);
        if (!confirm("この作業者を削除しますか？")) return;
        workerList.splice(idx, 1);
        render();
      };
    });
  }

  render();

  document.getElementById("add-worker-btn").onclick = () => {
    workerList.push({
      pin: "",
      name: "",
      display: "",
      role: "worker"
    });
    render();
  };

  document.getElementById("save-btn").onclick = async () => {
    showSaveModal("保存しています…");

    const pins = container.querySelectorAll(".worker-pin");
    const names = container.querySelectorAll(".worker-name");
    const displays = container.querySelectorAll(".worker-display");
    const roles = container.querySelectorAll(".worker-role");

    const newWorkers = [];

    pins.forEach((input, i) => {
      const pin = input.value.trim();
      const name = names[i].value.trim();
      const display = displays[i].value.trim();
      const role = roles[i].value.trim();

      if (!pin && !name && !display) return;

      newWorkers.push({
        pin,
        name,
        display,
        role: role || "worker"
      });
    });

    const savePath = `data/${dataName}.json`;
    await saveJSON(savePath, newWorkers);
    await bumpAuthVersion("workers.json saved");

    completeSaveModal("保存が完了しました");
  };
}

function renderRoleOptions(selected) {
  const roles = ["admin", "family", "worker"];
  return roles
    .map(role => `<option value="${role}" ${role === selected ? "selected" : ""}>${role}</option>`)
    .join("");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
