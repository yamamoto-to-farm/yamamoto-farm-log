// admin/edit-json/card-edit-workers.js
import { saveJSON } from "/common/json.js?v=1";
import { bumpAuthVersion } from "/common/ui.js";
import { showSaveModal, completeSaveModal } from "/common/save-modal.js?v=1";

export function renderEditCard({ dataName, json, container }) {
  const title = document.getElementById("page-title");
  if (title) title.textContent = "アクセス権限（workers.json）";

  const workerList = Array.isArray(json) ? [...json] : Array.isArray(json?.workers) ? [...json.workers] : [];
  let selectedIndex = -1;

  container.insertAdjacentHTML("beforeend", `
    <div class="card">
      <h2>アクセス権限</h2>
      <p style="margin:0 0 12px; color:#555;">
        権限と表示名で対象を絞り、一人ずつ編集できます。退職者の情報や在籍状況は従業員一覧で管理できます。
      </p>

      <div class="sub-card" style="margin-bottom:14px;">
        <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:end;">
          <div>
            <label class="form-label" for="worker-role-filter">権限で絞り込み</label>
            <select id="worker-role-filter" class="form-input">
              <option value="all">すべて</option>
              ${renderRoleOptions("")}
            </select>
          </div>
          <div>
            <label class="form-label" for="worker-search">表示名・識別名で検索</label>
            <input id="worker-search" class="form-input" placeholder="名前を入力">
          </div>
          <div style="flex:1; min-width:240px;">
            <label class="form-label" for="worker-target">編集対象</label>
            <select id="worker-target" class="form-input"></select>
          </div>
          <button id="add-worker-btn" class="secondary-btn" type="button">＋ ユーザーを追加</button>
        </div>
        <div id="worker-count" style="margin-top:8px; color:#555;"></div>
      </div>

      <div id="worker-editor"></div>

      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:20px;">
        <a class="secondary-btn" href="/admin/access.html">従業員一覧</a>
        <button id="save-btn" class="primary-btn" type="button">保存する</button>
      </div>
    </div>
  `);

  const editorEl = container.querySelector("#worker-editor");
  const roleFilterEl = container.querySelector("#worker-role-filter");
  const searchEl = container.querySelector("#worker-search");
  const targetEl = container.querySelector("#worker-target");
  const countEl = container.querySelector("#worker-count");

  function syncEditorToList() {
    if (selectedIndex < 0 || !workerList[selectedIndex]) return;
    const role = editorEl.querySelector(".worker-role")?.value || "worker";
    const pinInput = editorEl.querySelector(".worker-pin");
    workerList[selectedIndex] = {
      ...workerList[selectedIndex],
      pin: pinInput?.value.trim() || "",
      name: editorEl.querySelector(".worker-name")?.value.trim() || "",
      display: editorEl.querySelector(".worker-display")?.value.trim() || "",
      role
    };
  }

  function getFilteredIndices() {
    const roleFilter = roleFilterEl.value;
    const query = searchEl.value.trim().toLocaleLowerCase();
    return workerList
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => roleFilter === "all" || (item.role || "worker") === roleFilter)
      .filter(({ item }) => {
        if (!query) return true;
        return [item.display, item.name]
          .some(value => String(value || "").toLocaleLowerCase().includes(query));
      })
      .map(({ index }) => index);
  }

  function renderEditor() {
    editorEl.innerHTML = "";
    const item = workerList[selectedIndex];
    if (!item) {
      editorEl.innerHTML = '<p class="info-line">条件に合うユーザーがいません。</p>';
      return;
    }

    const role = item.role || "worker";
    const retired = role === "worker" && item.employmentStatus === "retired";
    editorEl.insertAdjacentHTML("beforeend", `
      <div class="sub-card">
        ${role === "worker" ? `<div class="info-line">${retired ? "退職済み（従業員情報は保持）" : "在籍中"}</div>` : ""}
        <div class="form-row">
          <label class="form-label">PIN</label>
          <input class="form-input worker-pin" value="${escapeHtml(retired ? "" : item.pin ?? "")}" placeholder="${retired ? "退職者は設定できません" : "ログイン用PIN"}" ${retired ? "disabled" : ""}>
        </div>
        <div class="form-row">
          <label class="form-label">識別名</label>
          <input class="form-input worker-name" value="${escapeHtml(item.name ?? "")}">
        </div>
        <div class="form-row">
          <label class="form-label">表示名</label>
          <input class="form-input worker-display" value="${escapeHtml(item.display ?? "")}">
        </div>
        <div class="form-row">
          <label class="form-label">権限</label>
          <select class="form-input worker-role">${renderRoleOptions(role)}</select>
        </div>
        <button class="secondary-btn delete-worker-btn" type="button" style="margin-top:8px;">
          ${role === "worker" ? "アクセス権を削除" : "ユーザーを削除"}
        </button>
      </div>
    `);

    editorEl.querySelector(".worker-role").addEventListener("change", event => {
      syncEditorToList();
      roleFilterEl.value = event.target.value;
      renderTargets();
    });

    editorEl.querySelector(".delete-worker-btn").addEventListener("click", () => {
      syncEditorToList();
      const current = workerList[selectedIndex];
      if (current?.role === "worker") {
        if (!confirm("この従業員のPINだけを削除し、従業員情報は残しますか？")) return;
        current.pin = "";
        editorEl.querySelector(".worker-pin").value = "";
      } else {
        if (!confirm("このユーザーを削除しますか？")) return;
        workerList.splice(selectedIndex, 1);
        selectedIndex = -1;
      }
      renderTargets();
    });
  }

  function renderTargets() {
    syncEditorToList();
    const indices = getFilteredIndices();
    if (!indices.includes(selectedIndex)) selectedIndex = indices[0] ?? -1;

    targetEl.innerHTML = indices.map(index => {
      const item = workerList[index];
      const role = item.role || "worker";
      const status = role === "worker"
        ? (item.employmentStatus === "retired" ? "・退職済み" : "・在籍中")
        : "";
      const label = `${item.display || "（表示名未設定）"}（${roleLabel(role)}${status}）`;
      return `<option value="${index}">${escapeHtml(label)}</option>`;
    }).join("");
    targetEl.value = selectedIndex >= 0 ? String(selectedIndex) : "";
    countEl.textContent = `${indices.length} 人`;
    renderEditor();
  }

  targetEl.addEventListener("change", () => {
    syncEditorToList();
    selectedIndex = Number(targetEl.value);
    renderEditor();
  });
  roleFilterEl.addEventListener("change", renderTargets);
  searchEl.addEventListener("input", renderTargets);

  renderTargets();

  document.getElementById("add-worker-btn").onclick = () => {
    syncEditorToList();
    workerList.push({
      pin: "",
      name: "",
      display: "",
      role: "worker"
    });
    searchEl.value = "";
    roleFilterEl.value = "worker";
    editorEl.innerHTML = "";
    selectedIndex = workerList.length - 1;
    renderTargets();
  };

  document.getElementById("save-btn").onclick = async () => {
    syncEditorToList();
    const newWorkers = [];
    const names = new Set();
    for (const item of workerList) {
      const name = String(item.name || "").trim();
      const display = String(item.display || "").trim();
      const pin = String(item.pin || "").trim();
      if (!name && !display && !pin) continue;
      if (!name || !display) {
        alert("識別名と表示名を入力してください。");
        return;
      }
      if (names.has(name)) {
        alert(`識別名「${name}」が重複しています。`);
        return;
      }
      names.add(name);
      newWorkers.push({
        ...item,
        pin: item.role === "worker" && item.employmentStatus === "retired" ? "" : pin,
        name,
        display,
        role: item.role || "worker"
      });
    }

    showSaveModal("保存しています…");
    try {
      const savePath = `data/${dataName}.json`;
      await saveJSON(savePath, newWorkers);
      await bumpAuthVersion("workers.json saved");
      completeSaveModal("保存が完了しました");
    } catch (error) {
      console.error("アクセス権限の保存に失敗しました:", error);
      completeSaveModal("保存に失敗しました");
    }
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

function roleLabel(role) {
  return {
    admin: "管理者",
    family: "家族",
    worker: "従業員"
  }[role] || "従業員";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
