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
      <h2>アクセス権限一覧</h2>
      <p style="margin:0 0 12px; color:#555;">
        PIN と権限を管理します。退職者の情報や在籍状況は従業員一覧で管理できます。
      </p>
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px;">
        <a class="secondary-btn" href="/admin/access.html">従業員一覧</a>
        <button id="add-worker-btn" class="secondary-btn" type="button">＋ ユーザーを追加</button>
      </div>
      <div id="worker-list"></div>

      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:20px;">
        <button id="save-btn" class="primary-btn" type="button">保存する</button>
      </div>
    </div>
  `);

  const listEl = document.getElementById("worker-list");

  function syncWorkerListFromForm() {
    const pins = container.querySelectorAll(".worker-pin");
    const names = container.querySelectorAll(".worker-name");
    const displays = container.querySelectorAll(".worker-display");
    const roles = container.querySelectorAll(".worker-role");
    pins.forEach((input, index) => {
      workerList[index] = {
        ...(workerList[index] || {}),
        pin: input.value.trim(),
        name: names[index].value.trim(),
        display: displays[index].value.trim(),
        role: roles[index].value.trim() || "worker"
      };
    });
  }

  function render() {
    listEl.innerHTML = "";

    workerList.forEach((item, index) => {
      const pin = item.pin ?? "";
      const name = item.name ?? "";
      const display = item.display ?? "";
      const role = item.role ?? "worker";
      const retired = role === "worker" && item.employmentStatus === "retired";

      listEl.insertAdjacentHTML("beforeend", `
        <div class="sub-card" style="margin-bottom:12px;">
          ${role === "worker" ? `<div class="info-line">${retired ? "退職済み（従業員情報は保持）" : "在籍中"}</div>` : ""}
          <div class="form-row">
            <label class="form-label">PIN</label>
            <input class="form-input worker-pin" data-index="${index}" value="${escapeHtml(retired ? "" : pin)}" placeholder="${retired ? "退職者は設定できません" : "ログイン用PIN"}" ${retired ? "disabled" : ""}>
          </div>

          <div class="form-row">
            <label class="form-label">識別名</label>
            <input class="form-input worker-name" data-index="${index}" value="${escapeHtml(name)}">
          </div>

          <div class="form-row">
            <label class="form-label">表示名</label>
            <input class="form-input worker-display" data-index="${index}" value="${escapeHtml(display)}">
          </div>

          <div class="form-row">
            <label class="form-label">権限</label>
            <select class="form-input worker-role" data-index="${index}">
              ${renderRoleOptions(role)}
            </select>
          </div>

          <button class="secondary-btn delete-worker-btn" data-index="${index}" style="margin-top:8px;">
            ${role === "worker" ? "アクセス権を削除" : "ユーザーを削除"}
          </button>
        </div>
      `);
    });

    document.querySelectorAll(".delete-worker-btn").forEach(btn => {
      btn.onclick = () => {
        const idx = Number(btn.dataset.index);
        syncWorkerListFromForm();
        const item = workerList[idx];
        if (item?.role === "worker") {
          if (!confirm("この従業員のPINだけを削除し、従業員情報は残しますか？")) return;
          item.pin = "";
        } else {
          if (!confirm("このユーザーを削除しますか？")) return;
          workerList.splice(idx, 1);
        }
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
        ...(workerList[i] || {}),
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
  const roles = [
    { value: "admin", label: "管理者" },
    { value: "family", label: "家族" },
    { value: "worker", label: "従業員" }
  ];
  return roles
    .map(role => `<option value="${role.value}" ${role.value === selected ? "selected" : ""}>${role.label}</option>`)
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
