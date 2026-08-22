// admin/edit-json/card-edit-varieties.js
import { loadJSON, saveJSON } from "/common/json.js?v=1";
import { showSaveModal, completeSaveModal } from "/common/save-modal.js?v=1";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function createDefaultVarietyDetail() {
  return {
    maker: "",
    sowingPeriod: "",
    harvestPeriod: "",
    bestGrowth: "",
    coldTolerance: "",
    features: "",
    memo: "",
    gdd: {
      mode: "effective",
      dapRange: null,
      expectedCropType: null,
      seasonCorrection: {
        lowSun: null,
        lowTemp: null
      }
    }
  };
}

async function syncVarietyDetailByVarieties(varietyList) {
  let currentDetail = {};
  try {
    currentDetail = await loadJSON("/data/variety-detail.json");
  } catch {
    currentDetail = {};
  }

  const template = {
    ...createDefaultVarietyDetail(),
    ...(currentDetail.TEMPLATE_VARIETY || {})
  };

  const nextDetail = {};
  if (Object.prototype.hasOwnProperty.call(currentDetail, "TEMPLATE_VARIETY")) {
    nextDetail.TEMPLATE_VARIETY = template;
  }

  varietyList.forEach(item => {
    const name = String(item.name || "").trim();
    if (!name) return;

    const prev = currentDetail[name] || {};
    nextDetail[name] = {
      ...template,
      ...prev,
      gdd: {
        ...template.gdd,
        ...(prev.gdd || {})
      }
    };
  });

  await saveJSON("data/variety-detail.json", nextDetail);

  let currentTargets = {};
  try {
    currentTargets = await loadJSON("/data/gdd-targets.json");
  } catch {
    currentTargets = {};
  }

  const nextTargets = {};
  varietyList.forEach(item => {
    const name = String(item.name || "").trim();
    if (!name) return;
    const previous = currentTargets[name];
    nextTargets[name] = previous && typeof previous === "object"
      ? previous
      : { mode: "effective", targets: {} };
  });
  await saveJSON("data/gdd-targets.json", nextTargets);
}

export function renderEditCard({ json, container, finalPath }) {
  const title = document.getElementById("page-title");
  if (title) title.textContent = "品種基本情報（varieties.json）";

  const params = new URLSearchParams(location.search);
  const initialVariety = String(params.get("variety") || "").trim();

  let listData = Array.isArray(json)
    ? json.map(v => ({ ...v }))
    : Object.values(json || {}).map(v => ({ ...v }));

  let nameKeyword = "";
  let selectedVarietyIndex = -1;

  container.insertAdjacentHTML("beforeend", `
    <div class="card">
      <h2>品種一覧</h2>
      <p style="margin:0 0 12px; color:#555;">
        品種名の追加・削除を保存すると、variety-detail.json と gdd-targets.json も同じ品種名で同期されます。
      </p>

      <div class="sub-card" style="margin-bottom:14px; background:#f8fbff; border:1px solid #dbeafe;">
        <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:end;">
          <div>
            <label class="form-label">品種検索（部分一致）</label>
            <input id="variety-name-search" class="form-input" style="min-width:220px;" placeholder="品種名・種別で検索">
          </div>
          <div>
            <label class="form-label">編集対象を選択</label>
            <button id="open-variety-target-modal" class="secondary-btn" type="button" style="min-width:320px; text-align:left;">
              品種を選択
            </button>
            <div id="variety-target-current" style="margin-top:6px; color:#555;"></div>
          </div>
          <button id="add-variety-btn" class="secondary-btn" type="button">＋ 品種を追加</button>
        </div>
        <div id="variety-visible-count" style="margin-top:8px; color:#555;"></div>
      </div>

      <div id="variety-list"></div>

      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:20px;">
        <button id="sort-variety-btn" class="secondary-btn" type="button">名前順に並び替え</button>
        <button id="go-variety-detail-btn" class="secondary-btn" type="button">品種詳細情報へ</button>
        <button id="save-btn" class="primary-btn">保存する</button>
      </div>
    </div>
  `);

  const listEl = document.getElementById("variety-list");
  const nameSearchEl = document.getElementById("variety-name-search");
  const openTargetModalBtn = document.getElementById("open-variety-target-modal");
  const targetCurrentEl = document.getElementById("variety-target-current");
  const countEl = document.getElementById("variety-visible-count");
  const goDetailBtn = document.getElementById("go-variety-detail-btn");

  function normalizeRows() {
    listData = listData.map(v => ({
      name: String(v.name || "").trim(),
      type: String(v.type || "").trim(),
      harvestMonth: v.harvestMonth == null || v.harvestMonth === "" ? "" : String(v.harvestMonth)
    }));
  }

  function syncVisibleRowToListData() {
    const card = listEl.querySelector(".sub-card[data-index]");
    if (!card) return;

    const idx = Number(card.dataset.index);
    if (!Number.isInteger(idx) || !listData[idx]) return;

    listData[idx] = {
      ...listData[idx],
      name: String(card.querySelector(".variety-name")?.value || "").trim(),
      type: String(card.querySelector(".variety-type")?.value || "").trim(),
      harvestMonth: String(card.querySelector(".variety-harvest-month")?.value || "").trim()
    };
  }

  function getNameFilteredRows() {
    const q = String(nameKeyword || "").trim().toLowerCase();
    const rows = listData.map((item, index) => ({ item, index }));
    if (!q) return rows;

    return rows.filter(({ item }) => {
      const name = String(item.name || "").toLowerCase();
      const type = String(item.type || "").toLowerCase();
      return name.includes(q) || type.includes(q);
    });
  }

  function getVisibleRows() {
    const rows = getNameFilteredRows();
    if (!Number.isInteger(selectedVarietyIndex) || selectedVarietyIndex < 0) return rows.slice(0, 1);
    const selected = rows.find(v => v.index === selectedVarietyIndex);
    return selected ? [selected] : rows.slice(0, 1);
  }

  function getTargetRowsSorted() {
    return getNameFilteredRows()
      .sort((a, b) => {
        const typeCmp = String(a.item.type || "").localeCompare(String(b.item.type || ""), "ja");
        if (typeCmp !== 0) return typeCmp;
        return String(a.item.name || "").localeCompare(String(b.item.name || ""), "ja");
      });
  }

  function refreshTargetSelection() {
    const rows = getTargetRowsSorted();
    const indices = rows.map(v => v.index);

    if (!Number.isInteger(selectedVarietyIndex) || !indices.includes(selectedVarietyIndex)) {
      if (initialVariety) {
        const hit = rows.find(v => String(v.item.name || "").trim() === initialVariety);
        selectedVarietyIndex = hit ? hit.index : (indices[0] ?? -1);
      } else {
        selectedVarietyIndex = indices[0] ?? -1;
      }
    }

    const selected = rows.find(v => v.index === selectedVarietyIndex);
    const label = selected
      ? `${String(selected.item.type || "").trim() || "(種別未入力)"} / ${String(selected.item.name || "").trim() || "(品種名未入力)"}`
      : "対象なし";

    if (targetCurrentEl) targetCurrentEl.textContent = `現在: ${label}`;
  }

  function openTargetSelectModal() {
    syncVisibleRowToListData();

    const rows = getNameFilteredRows();
    if (rows.length === 0) {
      alert("表示対象の品種がありません。種別・品種検索条件を見直してください。");
      return;
    }

    const parents = [];
    const children = {};
    rows.forEach(({ item }) => {
      const type = String(item.type || "").trim() || "(種別未入力)";
      const name = String(item.name || "").trim() || "(品種名未入力)";
      if (!children[type]) {
        children[type] = [];
        parents.push(type);
      }
      if (!children[type].includes(name)) children[type].push(name);
    });

    const existing = document.getElementById("variety-target-modal-bg");
    if (existing) existing.remove();

    const modalBg = document.createElement("div");
    modalBg.id = "variety-target-modal-bg";
    modalBg.className = "modal-bg";
    modalBg.innerHTML = `
      <div class="modal">
        <div class="modal-close" id="variety-target-close">×</div>
        <h3>編集する品種の選択</h3>
        ${parents.map(type => `
          <div class="filter-block open" data-type="${escapeHtml(type)}">
            <div class="filter-header">
              <span class="filter-label">${escapeHtml(type)}</span>
              <span class="filter-toggle-btn">▼</span>
            </div>
            <div class="filter-children">
              ${(children[type] || []).map(name => `
                <div class="select-item" data-variety-name="${escapeHtml(name)}">${escapeHtml(name)}</div>
              `).join("")}
            </div>
          </div>
        `).join("")}
      </div>
    `;

    const close = () => modalBg.remove();
    modalBg.addEventListener("click", e => {
      if (e.target === modalBg) close();
    });
    document.body.appendChild(modalBg);

    document.getElementById("variety-target-close").onclick = close;
    modalBg.querySelectorAll(".filter-toggle-btn").forEach(btn => {
      btn.onclick = () => btn.closest(".filter-block")?.classList.toggle("open");
    });
    modalBg.querySelectorAll("[data-variety-name]").forEach(el => {
      el.onclick = () => {
        const selectedName = String(el.dataset.varietyName || "").trim();
        const hit = rows.find(v => String(v.item.name || "").trim() === selectedName);
        if (!hit) return;
        selectedVarietyIndex = hit.index;
        close();
        render();
      };
    });
  }

  function render() {
    normalizeRows();
    refreshTargetSelection();

    const searchableRows = getNameFilteredRows();
    const visibleRows = getVisibleRows();

    if (countEl) {
      countEl.textContent = `検索対象 ${searchableRows.length} 件 / 全体 ${listData.length} 件`;
    }

    listEl.innerHTML = "";

    if (visibleRows.length === 0) {
      listEl.innerHTML = `
        <div class="sub-card" style="margin-bottom:12px; color:#666;">
          表示対象がありません。種別・品種検索・編集対象の選択条件を見直してください。
        </div>
      `;
      return;
    }

    visibleRows.forEach(({ item, index }) => {
      const name = item.name ?? "";
      const type = item.type ?? "";
      const harvestMonth = item.harvestMonth ?? "";

      listEl.insertAdjacentHTML("beforeend", `
        <div class="sub-card" data-index="${index}" style="margin-bottom:12px;">
          <div class="form-row">
            <label class="form-label">品種名</label>
            <input class="form-input variety-name" data-index="${index}" value="${escapeHtml(name)}">
          </div>

          <div class="form-row">
            <label class="form-label">種別</label>
            <input class="form-input variety-type" data-index="${index}" value="${escapeHtml(type)}" placeholder="寒玉キャベツなど">
          </div>

          <div class="form-row">
            <label class="form-label">収穫月（1-12）</label>
            <input class="form-input variety-harvest-month" data-index="${index}" value="${escapeHtml(harvestMonth)}" inputmode="numeric" step="1" min="1" max="12">
          </div>

          <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:8px;">
            <button class="secondary-btn jump-variety-detail-btn" data-index="${index}" ${name ? "" : "disabled"}>
              詳細を開く
            </button>
            <button class="secondary-btn delete-variety-btn" data-index="${index}">
              削除
            </button>
          </div>
        </div>
      `);
    });

    document.querySelectorAll(".delete-variety-btn").forEach(btn => {
      btn.onclick = () => {
        syncVisibleRowToListData();
        const idx = Number(btn.dataset.index);
        if (!confirm("この品種を削除しますか？\n保存時に variety-detail からも削除されます。")) return;
        listData.splice(idx, 1);
        if (Number.isInteger(selectedVarietyIndex) && selectedVarietyIndex === idx) {
          selectedVarietyIndex = -1;
        } else if (Number.isInteger(selectedVarietyIndex) && selectedVarietyIndex > idx) {
          selectedVarietyIndex -= 1;
        }
        render();
      };
    });

    document.querySelectorAll(".jump-variety-detail-btn").forEach(btn => {
      btn.onclick = () => {
        syncVisibleRowToListData();
        const idx = Number(btn.dataset.index);
        const name = String(listData[idx]?.name || "").trim();

        if (!name) {
          alert("先に品種名を入力してください。");
          return;
        }

        location.href = `?data=variety-detail&variety=${encodeURIComponent(name)}`;
      };
    });
  }

  function buildRowsFromData() {
    syncVisibleRowToListData();

    const rows = [];
    const usedNames = new Set();

    for (let i = 0; i < listData.length; i += 1) {
      const row = listData[i] || {};
      const name = String(row.name || "").trim();
      const type = String(row.type || "").trim();
      const harvestMonthRaw = String(row.harvestMonth ?? "").trim();

      if (!name && !type && !harvestMonthRaw) {
        continue;
      }

      if (!name) {
        alert(`${i + 1}行目: 品種名は必須です。`);
        return null;
      }

      if (usedNames.has(name)) {
        alert(`品種名「${name}」が重複しています。`);
        return null;
      }
      usedNames.add(name);

      let harvestMonth = null;
      if (harvestMonthRaw !== "") {
        const n = Number(harvestMonthRaw);
        if (!Number.isInteger(n) || n < 1 || n > 12) {
          alert(`${i + 1}行目: 収穫月は 1〜12 の整数で入力してください。`);
          return null;
        }
        harvestMonth = n;
      }

      rows.push({ name, type, harvestMonth });
    }

    return rows;
  }

  render();

  nameSearchEl.oninput = () => {
    syncVisibleRowToListData();
    nameKeyword = nameSearchEl.value || "";
    selectedVarietyIndex = -1;
    render();
  };

  if (openTargetModalBtn) {
    openTargetModalBtn.onclick = openTargetSelectModal;
  }

  if (goDetailBtn) {
    goDetailBtn.onclick = () => {
      syncVisibleRowToListData();
      if (!Number.isInteger(selectedVarietyIndex) || selectedVarietyIndex < 0 || !listData[selectedVarietyIndex]) {
        alert("編集対象の品種を選択してください。");
        return;
      }
      const name = String(listData[selectedVarietyIndex].name || "").trim();
      if (!name) {
        alert("先に品種名を入力してください。");
        return;
      }
      location.href = `?data=variety-detail&variety=${encodeURIComponent(name)}`;
    };
  }

  document.getElementById("sort-variety-btn").onclick = () => {
    const rows = buildRowsFromData();
    if (!rows) return;

    listData = rows.sort((a, b) =>
      String(a.name || "").localeCompare(String(b.name || ""), "ja", { sensitivity: "base" })
    );
    selectedVarietyIndex = listData.length ? 0 : -1;
    render();
  };

  document.getElementById("add-variety-btn").onclick = () => {
    const rows = buildRowsFromData();
    if (!rows) return;

    listData = rows;
    listData.push({
      name: "",
      type: "",
      harvestMonth: ""
    });
    selectedVarietyIndex = listData.length - 1;
    render();
  };

  document.getElementById("save-btn").onclick = async () => {
    const newList = buildRowsFromData();
    if (!newList) return;

    showSaveModal("保存しています…");

    const savePath = "data/" + finalPath.replace(/^\/data\//, "");
    await saveJSON(savePath, newList);
    await syncVarietyDetailByVarieties(newList);

    completeSaveModal("保存が完了しました");
  };
}
