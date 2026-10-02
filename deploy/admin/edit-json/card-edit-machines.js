// admin/edit-json/card-edit-machines.js
import { loadJSON, saveJSON } from "/common/json.js?v=1";
import { showSaveModal, completeSaveModal } from "/common/save-modal.js?v=1";

export function renderEditCard({ dataName, json, container }) {
  const title = document.getElementById("page-title");
  if (title) title.textContent = "機械管理（machines.json）";
  const machineList = Array.isArray(json?.machines) ? [...json.machines] : [];
  let selectablePages = [];
  let pagesLoaded = false;
  let pageLoadFailed = false;
  let selectedIndex = machineList.length ? 0 : -1;
  let draftIndex = -1;

  container.insertAdjacentHTML("beforeend", `
    <div class="card">
      <h2>機械管理</h2>
      <p style="margin:0 0 12px; color:#555;">
        機械ごとの識別ID・名称と、QRから利用できる作業ページを管理します。
      </p>

      <div class="sub-card" style="margin-bottom:14px;">
        <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:end;">
          <div style="flex:1 1 220px;">
            <label class="form-label" for="machine-search">機械名・IDで検索</label>
            <input id="machine-search" class="form-input" placeholder="機械名またはIDを入力">
          </div>
          <div style="flex:1 1 280px;">
            <label class="form-label" for="machine-target">編集対象</label>
            <select id="machine-target" class="form-input"></select>
          </div>
          <button id="add-machine-btn" class="secondary-btn" type="button">＋ 機械を追加</button>
        </div>
        <div id="machine-count" style="margin-top:8px; color:#555;"></div>
      </div>

      <div id="machine-editor"></div>

      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:20px;">
        <button id="save-btn" class="primary-btn" type="button">保存する</button>
      </div>
    </div>
  `);

  const editorEl = container.querySelector("#machine-editor");
  const searchEl = container.querySelector("#machine-search");
  const targetEl = container.querySelector("#machine-target");
  const countEl = container.querySelector("#machine-count");

  function normalizePageIdList(value) {
    if (!Array.isArray(value)) return [];
    return value
      .map(v => String(v || "").trim())
      .filter(Boolean);
  }

  function renderPageCheckboxes(selectedIds) {
    if (!Array.isArray(selectablePages) || selectablePages.length === 0) {
      const message = pagesLoaded && pageLoadFailed
        ? "作業ページ一覧を読み込めませんでした。"
        : "作業ページ一覧を読み込み中です…";
      return `<p class="info-line">${message}</p>`;
    }

    const selected = new Set(normalizePageIdList(selectedIds));
    const groupedPages = new Map();
    selectablePages.forEach(page => {
      const category = page.category || "その他";
      if (!groupedPages.has(category)) groupedPages.set(category, []);
      groupedPages.get(category).push(page);
    });

    return [...groupedPages.entries()].map(([category, pages]) => `
      <section style="margin-top:12px;">
        <h3 style="margin:0 0 6px; font-size:14px;">${escapeHtml(category)}</h3>
        <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:8px;">
          ${pages.map(page => `
            <label style="display:flex; align-items:flex-start; gap:8px; padding:9px 10px; border:1px solid #e1e1e1; border-radius:8px; background:#fff; line-height:1.4; cursor:pointer;">
              <input type="checkbox" class="machine-page-check" value="${escapeHtml(page.id)}" ${selected.has(page.id) ? "checked" : ""}>
              <span>${escapeHtml(page.name)}<small style="display:block; color:#777;">${escapeHtml(page.id)}</small></span>
            </label>
          `).join("")}
        </div>
      </section>
    `).join("");
  }

  function syncEditorToList() {
    const item = machineList[selectedIndex];
    if (!item || !editorEl.querySelector(".machine-id")) return;
    const pageChecks = [...editorEl.querySelectorAll(".machine-page-check")];
    machineList[selectedIndex] = {
      ...item,
      id: editorEl.querySelector(".machine-id").value.trim(),
      name: editorEl.querySelector(".machine-name").value.trim(),
      allowedPageIds: pageChecks.length
        ? normalizePageIdList(pageChecks.filter(input => input.checked).map(input => input.value))
        : normalizePageIdList(item.allowedPageIds)
    };
  }

  function getFilteredIndices() {
    const query = searchEl.value.trim().toLocaleLowerCase();
    return machineList
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => !query || [item.name, item.id]
        .some(value => String(value || "").toLocaleLowerCase().includes(query)))
      .map(({ index }) => index);
  }

  function renderEditor() {
    editorEl.innerHTML = "";
    const item = machineList[selectedIndex];
    if (!item) {
      editorEl.innerHTML = '<p class="info-line">検索条件に合う機械がありません。</p>';
      return;
    }

    const selectedPageIds = normalizePageIdList(item.allowedPageIds);
    editorEl.insertAdjacentHTML("beforeend", `
      <div class="sub-card">
        <div class="form-row">
          <label class="form-label" for="machine-id">識別ID</label>
          <input id="machine-id" class="form-input machine-id" value="${escapeHtml(item.id ?? "")}" autocomplete="off">
        </div>
        <div class="form-row">
          <label class="form-label" for="machine-name">機械名</label>
          <input id="machine-name" class="form-input machine-name" value="${escapeHtml(item.name ?? "")}" autocomplete="off">
        </div>
        <div class="form-row" style="margin-top:14px;">
          <div style="display:flex; align-items:baseline; justify-content:space-between; gap:8px; flex-wrap:wrap;">
            <label class="form-label" style="margin:0;">利用できる作業ページ</label>
            <span id="machine-page-count" style="color:#555; font-size:13px;"></span>
          </div>
          <p style="margin:4px 0 8px; color:#666; font-size:13px;">この機械のQRから表示する作業ページを選択します。</p>
          <div style="border:1px solid #e1e1e1; border-radius:8px; padding:10px; background:#fafafa;">
            ${renderPageCheckboxes(selectedPageIds)}
          </div>
        </div>
        <button class="secondary-btn delete-machine-btn" type="button" style="margin-top:12px;">機械を削除</button>
      </div>
    `);
    updatePageCount();

    editorEl.querySelector(".delete-machine-btn").addEventListener("click", () => {
      syncEditorToList();
      if (!confirm("この機械を削除しますか？")) return;
      machineList.splice(selectedIndex, 1);
      if (selectedIndex === draftIndex) draftIndex = -1;
      else if (draftIndex > selectedIndex) draftIndex -= 1;
      selectedIndex = -1;
      renderTargets();
    });
  }

  function updatePageCount() {
    const count = editorEl.querySelectorAll(".machine-page-check:checked").length;
    const label = editorEl.querySelector("#machine-page-count");
    if (label) label.textContent = `${count} ページ選択中`;
  }

  function renderTargets() {
    syncEditorToList();
    const indices = getFilteredIndices();
    if (!indices.includes(selectedIndex)) selectedIndex = indices[0] ?? -1;

    targetEl.innerHTML = indices.map(index => {
      const item = machineList[index];
      const name = item.name || "（名称未設定）";
      const id = item.id || "ID未設定";
      return `<option value="${index}">${escapeHtml(name)}（${escapeHtml(id)}）</option>`;
    }).join("");
    targetEl.value = selectedIndex >= 0 ? String(selectedIndex) : "";
    countEl.textContent = `検索対象 ${indices.length} 台 / 全体 ${machineList.length} 台`;
    renderEditor();
  }

  targetEl.addEventListener("change", () => {
    syncEditorToList();
    selectedIndex = targetEl.value ? Number(targetEl.value) : -1;
    renderEditor();
  });
  searchEl.addEventListener("input", renderTargets);
  editorEl.addEventListener("change", event => {
    if (!event.target.matches(".machine-page-check")) return;
    syncEditorToList();
    updatePageCount();
  });

  renderTargets();

  document.getElementById("add-machine-btn").addEventListener("click", () => {
    syncEditorToList();
    if (draftIndex >= 0) {
      const draft = machineList[draftIndex];
      if (draft && (!String(draft.id || "").trim() || !String(draft.name || "").trim())) {
        searchEl.value = "";
        selectedIndex = draftIndex;
        renderTargets();
        alert("入力中の機械があります。識別IDと機械名を入力してから、次の機械を追加してください。");
        return;
      }
    }

    draftIndex = machineList.length;
    machineList.push({
      id: "",
      name: "",
      allowedPageIds: selectablePages.map(page => page.id)
    });
    searchEl.value = "";
    editorEl.innerHTML = "";
    selectedIndex = machineList.length - 1;
    renderTargets();
    editorEl.querySelector(".machine-id")?.focus();
  });

  document.getElementById("save-btn").onclick = async () => {
    syncEditorToList();
    const newMachines = [];
    const usedIds = new Set();
    for (const item of machineList) {
      const id = String(item.id || "").trim();
      const name = String(item.name || "").trim();
      if (!id && !name) continue;
      if (!id || !name) {
        alert("識別IDと機械名を両方入力してください。");
        return;
      }

      const idKey = id.toLocaleLowerCase();
      if (usedIds.has(idKey)) {
        alert(`識別ID「${id}」が重複しています。`);
        return;
      }
      usedIds.add(idKey);
      newMachines.push({
        ...item,
        id,
        name,
        allowedPageIds: normalizePageIdList(item.allowedPageIds)
      });
    }

    showSaveModal("保存しています…");
    try {
      const savePath = `data/${dataName}.json`;
      await saveJSON(savePath, { machines: newMachines });
      machineList.splice(0, machineList.length, ...newMachines);
      draftIndex = -1;
      selectedIndex = machineList.length ? Math.min(Math.max(selectedIndex, 0), machineList.length - 1) : -1;
      renderTargets();
      completeSaveModal("保存が完了しました");
    } catch (error) {
      console.error("機械マスタの保存に失敗しました:", error);
      completeSaveModal("保存に失敗しました");
    }
  };

  (async () => {
    try {
      const pagesJson = await loadJSON("/data/pages.json?v=1");
      selectablePages = Array.isArray(pagesJson?.pages)
        ? pagesJson.pages
          .filter(p => p && p.openLog === true && p.id && p.name && p.path)
          .map(p => ({
            id: String(p.id),
            name: String(p.name),
            category: String(p.category || "その他")
          }))
        : [];
    } catch {
      selectablePages = [];
      pageLoadFailed = true;
    } finally {
      pagesLoaded = true;
    }
    renderTargets();
  })();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
