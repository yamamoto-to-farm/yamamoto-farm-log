// admin/edit-json/card-edit-workers.js
import { saveJSON } from "/common/json.js?v=1";
import { bumpAuthVersion } from "/common/ui.js";
import { showSaveModal, completeSaveModal } from "/common/save-modal.js?v=1";

export function renderEditCard({ dataName, json, container }) {
  const title = document.getElementById("page-title");
  if (title) title.textContent = "ログイン権限管理（workers.json）";

  const workerList = Array.isArray(json) ? [...json] : Array.isArray(json?.workers) ? [...json.workers] : [];
  let selectedIndex = -1;
  let draftIndex = -1;

  function getNextPin(role) {
    const usedPins = new Set(workerList.map(item => String(item?.pin || "").trim()).filter(Boolean));
    const pattern = role === "worker" ? /^Y(\d+)$/i : /^(\d+)$/;
    const prefix = role === "worker" ? "Y" : "";
    const numbers = workerList
      .map(item => String(item?.pin || "").trim().match(pattern))
      .filter(Boolean)
      .map(match => Number(match[1]));
    let nextNumber = Math.max(0, ...numbers) + 1;
    let nextPin = `${prefix}${String(nextNumber).padStart(3, "0")}`;
    while (usedPins.has(nextPin)) {
      nextNumber += 1;
      nextPin = `${prefix}${String(nextNumber).padStart(3, "0")}`;
    }
    return nextPin;
  }

  function isPinValidForRole(pin, role) {
    if (role === "worker") return /^Y\d{3,}$/i.test(pin);
    return /^\d{3}$/.test(pin);
  }

  container.insertAdjacentHTML("beforeend", `
    <div class="card">
      <h2>ログイン権限管理</h2>
      <p style="margin:0 0 12px; color:#555;">
        ログイン用PINと権限を管理します。従業員の識別名・表示名・在籍状況は従業員在籍状況で管理し、この画面ではPINと権限のみ変更できます。管理者・家族アカウントの追加や基本情報の編集もここで行います。
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
          <button id="add-worker-btn" class="secondary-btn" type="button">＋ アカウントを追加（PIN自動採番）</button>
        </div>
        <div id="worker-count" style="margin-top:8px; color:#555;"></div>
      </div>

      <div id="worker-editor"></div>

      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:20px;">
        <a class="secondary-btn" href="/admin/access.html">従業員在籍状況</a>
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
    const roleInput = editorEl.querySelector(".worker-role");
    const nameInput = editorEl.querySelector(".worker-name");
    const displayInput = editorEl.querySelector(".worker-display");
    if (!roleInput || !nameInput || !displayInput) return;
    const pinInput = editorEl.querySelector(".worker-pin");
    workerList[selectedIndex] = {
      ...workerList[selectedIndex],
      pin: pinInput?.value.trim() || "",
      name: nameInput.readOnly ? workerList[selectedIndex].name : nameInput.value.trim(),
      display: displayInput.readOnly ? workerList[selectedIndex].display : displayInput.value.trim(),
      role: roleInput.value || workerList[selectedIndex].role || "worker"
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
          <input class="form-input worker-name" value="${escapeHtml(item.name ?? "")}" ${role === "worker" ? "readonly" : ""}>
        </div>
        <div class="form-row">
          <label class="form-label">表示名</label>
          <input class="form-input worker-display" value="${escapeHtml(item.display ?? "")}" ${role === "worker" ? "readonly" : ""}>
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
    editorEl.querySelector(".worker-role").value = role;

    editorEl.querySelector(".worker-role").addEventListener("change", event => {
      syncEditorToList();
      const nextRole = event.target.value;
      const pinInput = editorEl.querySelector(".worker-pin");
      const currentPin = String(pinInput?.value || "").trim();
      if (!isPinValidForRole(currentPin, nextRole)) {
        const nextPin = getNextPin(nextRole);
        if (pinInput) pinInput.value = nextPin;
        workerList[selectedIndex].pin = nextPin;
      }
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
        if (selectedIndex === draftIndex) draftIndex = -1;
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
    if (draftIndex >= 0) {
      const draft = workerList[draftIndex];
      if (draft && (!String(draft.name || "").trim() || !String(draft.display || "").trim())) {
        selectedIndex = draftIndex;
        renderTargets();
        alert("入力中のアカウントがあります。識別名と表示名を入力してから、次のアカウントを追加してください。");
        return;
      }
    }

    draftIndex = workerList.length;
    workerList.push({
      pin: getNextPin("worker"),
      name: "",
      display: "",
      role: "worker"
    });
    searchEl.value = "";
    roleFilterEl.value = "all";
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
      if (!name && !display) continue;
      if (!name || !display) {
        alert("識別名と表示名を入力してください。");
        return;
      }
      const isRetiredWithoutPin = item.role === "worker" && item.employmentStatus === "retired" && !pin;
      if (!isRetiredWithoutPin && !isPinValidForRole(pin, item.role || "worker")) {
        alert(`${display} のPINが権限に合っていません。従業員はY＋3桁以上、家族・管理者は数字3桁で入力してください。`);
        return;
      }
      if (names.has(name)) {
        alert(`識別名「${name}」が重複しています。`);
        return;
      }
      names.add(name);
      if (newWorkers.some(existing => existing.pin === pin)) {
        alert(`PIN「${pin}」が重複しています。`);
        return;
      }
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
      workerList.splice(0, workerList.length, ...newWorkers);
      draftIndex = -1;
      selectedIndex = workerList.length ? Math.min(selectedIndex, workerList.length - 1) : -1;
      renderTargets();
      completeSaveModal("保存が完了しました");
    } catch (error) {
      console.error("ログイン権限の保存に失敗しました:", error);
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
