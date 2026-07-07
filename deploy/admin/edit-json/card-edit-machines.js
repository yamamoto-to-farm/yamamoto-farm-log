// admin/edit-json/card-edit-machines.js
import { loadJSON, saveJSON } from "/common/json.js?v=1";
import { showSaveModal, completeSaveModal } from "/common/save-modal.js?v=1";

export function renderEditCard({ dataName, json, container }) {
  const title = document.getElementById("page-title");
  if (title) title.textContent = "機械（machines.json）";

  const machineList = Array.isArray(json?.machines) ? [...json.machines] : [];
  let selectablePages = [];

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

  function normalizePageIdList(value) {
    if (!Array.isArray(value)) return [];
    return value
      .map(v => String(v || "").trim())
      .filter(Boolean);
  }

  function renderPageCheckboxes(index, selectedIds) {
    if (!Array.isArray(selectablePages) || selectablePages.length === 0) {
      return `<p style="margin:8px 0 0; color:#777;">ページ一覧を読み込めませんでした。</p>`;
    }

    const selected = new Set(normalizePageIdList(selectedIds));

    return selectablePages
      .map(p => {
        const checked = selected.has(p.id) ? "checked" : "";
        return `
          <label style="display:block; margin:6px 0; line-height:1.4;">
            <input type="checkbox" class="machine-page-check" data-index="${index}" value="${escapeHtml(p.id)}" ${checked}>
            ${escapeHtml(p.name)}
            <span style="color:#777; font-size:12px;">（${escapeHtml(p.id)}）</span>
          </label>
        `;
      })
      .join("");
  }

  function render() {
    listEl.innerHTML = "";

    machineList.forEach((item, index) => {
      const id = item.id ?? "";
      const name = item.name ?? "";
      const allowedPageIds = normalizePageIdList(item.allowedPageIds);

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

          <div class="form-row" style="margin-top:10px;">
            <label class="form-label">ハブページに表示する作業</label>
            <div style="border:1px solid #e1e1e1; border-radius:8px; padding:10px; background:#fafafa;">
              ${renderPageCheckboxes(index, allowedPageIds)}
            </div>
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
      name: "",
      allowedPageIds: selectablePages.map(p => p.id)
    });
    render();
  };

  document.getElementById("save-btn").onclick = async () => {
    showSaveModal("保存しています…");

    const ids = container.querySelectorAll(".machine-id");
    const names = container.querySelectorAll(".machine-name");
    const allChecks = Array.from(container.querySelectorAll(".machine-page-check"));

    const newMachines = [];

    ids.forEach((input, i) => {
      const id = input.value.trim();
      const name = names[i].value.trim();
      const base = machineList[i] || {};

      const allowedPageIds = allChecks
        .filter(chk => Number(chk.dataset.index) === i && chk.checked)
        .map(chk => String(chk.value || "").trim())
        .filter(Boolean);

      if (!id && !name) return;

      newMachines.push({
        ...base,
        id,
        name,
        allowedPageIds
      });
    });

    const savePath = `data/${dataName}.json`;
    await saveJSON(savePath, { machines: newMachines });

    completeSaveModal("保存が完了しました");
  };

  (async () => {
    try {
      const pagesJson = await loadJSON("/data/pages.json?v=1");
      selectablePages = Array.isArray(pagesJson?.pages)
        ? pagesJson.pages
          .filter(p => p && p.openLog === true && p.id && p.name && p.path)
          .map(p => ({ id: String(p.id), name: String(p.name) }))
        : [];
    } catch {
      selectablePages = [];
    }

    render();
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
