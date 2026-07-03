// admin/edit-json/card-edit-fertilizer-index.js
import { loadJSON, saveJSON } from "/common/json.js?v=1";
import { showSaveModal, completeSaveModal } from "/common/save-modal.js?v=1";

const FERTILIZER_CATEGORIES = [
  "BB",
  "化成",
  "窒素肥料",
  "改良材",
  "堆肥",
  "土壌消毒剤"
];

function createEmptyFertilizerDetail(name = "") {
  return {
    name,
    maker: "",
    price: {},
    n: 0,
    p: 0,
    k: 0,
    notes: "",
    ingredients: [],
    applications: [],
    activeIngredients: [],
    targetCrops: []
  };
}

function toDetailPath(indexSavePath) {
  return indexSavePath.replace(/-index\.json$/, "-detail.json");
}

async function syncFertilizerDetail(indexSavePath, indexList) {
  const detailSavePath = toDetailPath(indexSavePath);

  let currentDetail = {};
  try {
    currentDetail = await loadJSON(`/${detailSavePath}`);
  } catch {
    currentDetail = {};
  }

  const nextDetail = {};

  indexList.forEach(item => {
    const id = (item.id || "").trim();
    if (!id) return;

    const prev = currentDetail[id] || {};
    nextDetail[id] = {
      ...createEmptyFertilizerDetail(item.name || ""),
      ...prev,
      name: item.name || prev.name || ""
    };
  });

  await saveJSON(detailSavePath, nextDetail);
}

function normalizeFertilizerId(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return "";

  const m = raw.match(/^F(\d{1,3})$/);
  if (m) {
    return `F${String(Number(m[1])).padStart(3, "0")}`;
  }

  return raw;
}

function buildFertilizerIdSuggestions(list, maxCount = 40) {
  const existing = new Set(
    list
      .map(v => normalizeFertilizerId(v?.id || ""))
      .filter(Boolean)
  );

  const out = [];
  for (let i = 1; i <= 999 && out.length < maxCount; i++) {
    const id = `F${String(i).padStart(3, "0")}`;
    if (!existing.has(id)) out.push(id);
  }
  return out;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderEditCard({ json, container, finalPath }) {
  const title = document.getElementById("page-title");
  if (title) title.textContent = "肥料基本情報（fertilizer-index.json）";

  let listData = Array.isArray(json)
    ? json.map(v => ({ ...v }))
    : Object.values(json || {}).map(v => ({ ...v }));

  let selectedCategory = "";

  container.insertAdjacentHTML("beforeend", `
    <div class="card">
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px;">
        <button class="secondary-btn" type="button" onclick="location.href='?data=fertilizer-detail'">肥料詳細情報へ</button>
      </div>

      <h2>肥料一覧</h2>

      <div class="sub-card" style="margin-bottom:14px; background:#f8fbff; border:1px solid #dbeafe;">
        <p style="margin:0 0 6px;"><strong>入力ルール（README抜粋）</strong></p>
        <p style="margin:0 0 4px;">ID: <strong>FNNN</strong> 形式（例: F001）</p>
        <p style="margin:0 0 4px;">カテゴリ: BB / 化成 / 窒素肥料 / 改良材 / 堆肥 / 土壌消毒剤</p>
        <p style="margin:0; font-size:0.92em; color:#555;">ID は重複しない連番で管理し、名称変更時もIDは維持してください。</p>
      </div>

      <div class="sub-card" style="margin-bottom:14px;">
        <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:end;">
          <div>
            <label class="form-label">カテゴリフィルタ</label>
            <select id="fert-category-filter" class="form-input" style="min-width:200px;"></select>
          </div>
          <div>
            <label class="form-label">ID候補（未使用）</label>
            <select id="fert-id-candidate-select" class="form-input" style="min-width:180px;"></select>
          </div>
          <button id="add-fert-from-candidate" class="secondary-btn" type="button">候補IDで追加</button>
        </div>
        <div id="fert-visible-count" style="margin-top:8px; color:#555;"></div>
      </div>

      <datalist id="fert-id-datalist"></datalist>
      <div id="fertilizer-list"></div>

      <button id="sort-fertilizer-btn" class="secondary-btn" style="margin-top:12px;">
        ID順に並び替え
      </button>

      <button id="add-fertilizer-btn" class="primary-btn" style="margin-top:20px;">
        ＋ 肥料を追加
      </button>

      <button id="save-btn" class="primary-btn" style="margin-top:20px;">
        保存する
      </button>
    </div>
  `);

  const listEl = document.getElementById("fertilizer-list");
  const filterEl = document.getElementById("fert-category-filter");
  const candidateEl = document.getElementById("fert-id-candidate-select");
  const datalistEl = document.getElementById("fert-id-datalist");
  const countEl = document.getElementById("fert-visible-count");

  function normalizeRows() {
    listData = listData.map(v => ({
      id: normalizeFertilizerId(v.id || ""),
      category: String(v.category || "").trim(),
      name: String(v.name || "").trim(),
      capacity: v.capacity == null || v.capacity === "" ? null : Number(v.capacity)
    }));
  }

  function syncVisibleRowsToListData() {
    const ids = container.querySelectorAll(".fert-id");
    const categories = container.querySelectorAll(".fert-category");
    const names = container.querySelectorAll(".fert-name");
    const capacities = container.querySelectorAll(".fert-capacity");

    ids.forEach((input, i) => {
      const idx = Number(input.dataset.index);
      if (!Number.isInteger(idx) || !listData[idx]) return;

      const id = normalizeFertilizerId(input.value);
      const category = categories[i].value.trim();
      const name = names[i].value.trim();
      const capacityRaw = capacities[i].value.trim();

      listData[idx] = {
        ...listData[idx],
        id,
        category,
        name,
        capacity: capacityRaw === "" ? null : Number(capacityRaw)
      };
    });
  }

  function compactListData() {
    listData = listData.filter(v => {
      const id = String(v.id || "").trim();
      const name = String(v.name || "").trim();
      return id || name;
    });
  }

  function getVisibleRows() {
    return listData
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => {
        if (!selectedCategory) return true;
        return String(item.category || "").trim() === selectedCategory;
      });
  }

  function refreshFilterOptions() {
    const catSet = new Set(FERTILIZER_CATEGORIES);
    listData.forEach(v => {
      const cat = String(v.category || "").trim();
      if (cat) catSet.add(cat);
    });

    const options = ["", ...Array.from(catSet)];
    filterEl.innerHTML = options
      .map(v => `<option value="${escapeHtml(v)}">${v ? escapeHtml(v) : "全カテゴリ"}</option>`)
      .join("");

    filterEl.value = selectedCategory;
  }

  function refreshIdSuggestions() {
    const suggestions = buildFertilizerIdSuggestions(listData, 40);

    candidateEl.innerHTML = suggestions
      .map(v => `<option value="${v}">${v}</option>`)
      .join("");

    datalistEl.innerHTML = suggestions
      .map(v => `<option value="${v}"></option>`)
      .join("");
  }

  function render() {
    normalizeRows();
    refreshFilterOptions();
    refreshIdSuggestions();

    const visible = getVisibleRows();

    if (countEl) {
      countEl.textContent = `表示中 ${visible.length} 件 / 全体 ${listData.length} 件`;
    }

    listEl.innerHTML = "";

    visible.forEach(({ item, index }) => {
      const id = item.id ?? "";
      const category = item.category ?? "";
      const name = item.name ?? "";
      const capacity = item.capacity ?? "";

      listEl.insertAdjacentHTML("beforeend", `
        <div class="sub-card" style="margin-bottom:12px;">
          <div class="form-row">
            <label class="form-label">ID</label>
            <input class="form-input fert-id" list="fert-id-datalist" data-index="${index}" value="${escapeHtml(id)}" placeholder="F001">
          </div>

          <div class="form-row">
            <label class="form-label">カテゴリ</label>
            <input class="form-input fert-category" data-index="${index}" value="${escapeHtml(category)}" placeholder="BB / 化成 ...">
          </div>

          <div class="form-row">
            <label class="form-label">名称</label>
            <input class="form-input fert-name" data-index="${index}" value="${escapeHtml(name)}">
          </div>

          <div class="form-row">
            <label class="form-label">容量（kgなど）</label>
            <input class="form-input fert-capacity" data-index="${index}" value="${escapeHtml(capacity)}" inputmode="decimal">
          </div>

          <button class="secondary-btn delete-fert-btn" data-index="${index}" style="margin-top:8px;">
            削除
          </button>
        </div>
      `);
    });

    document.querySelectorAll(".delete-fert-btn").forEach(btn => {
      btn.onclick = () => {
        const idx = Number(btn.dataset.index);
        if (!confirm("この肥料を削除しますか？")) return;
        listData.splice(idx, 1);
        render();
      };
    });
  }

  function validateBeforeSave(rows) {
    const errors = [];
    const usedIds = new Set();

    if (rows.length === 0) {
      errors.push("保存対象がありません。1件以上入力してください。");
      return errors;
    }

    rows.forEach((row, i) => {
      const line = i + 1;
      const id = normalizeFertilizerId(row.id);
      const category = String(row.category || "").trim();
      const name = String(row.name || "").trim();

      if (!id) errors.push(`${line}行目: ID は必須です。`);
      if (id && !/^F\d{3}$/.test(id)) {
        errors.push(`${line}行目: ID は FNNN 形式で入力してください（例: F001）。`);
      }
      if (id && usedIds.has(id)) {
        errors.push(`${line}行目: ID ${id} が重複しています。`);
      }
      if (id) usedIds.add(id);

      if (!category) errors.push(`${line}行目: カテゴリは必須です。`);
      if (!name) errors.push(`${line}行目: 名称は必須です。`);

      if (row.capacity != null && row.capacity !== "") {
        const n = Number(row.capacity);
        if (!Number.isFinite(n)) {
          errors.push(`${line}行目: 容量は数値で入力してください。`);
        }
      }
    });

    return errors;
  }

  filterEl.onchange = () => {
    syncVisibleRowsToListData();
    selectedCategory = filterEl.value || "";
    render();
  };

  document.getElementById("add-fert-from-candidate").onclick = () => {
    syncVisibleRowsToListData();

    const candidate = String(candidateEl.value || "").trim();
    if (!candidate) return;

    const exists = listData.some(v => normalizeFertilizerId(v.id) === candidate);
    if (exists) {
      alert(`ID ${candidate} は既に存在します。`);
      return;
    }

    listData.push({
      id: candidate,
      category: selectedCategory || "",
      name: "",
      capacity: null
    });

    render();
  };

  document.getElementById("sort-fertilizer-btn").onclick = () => {
    syncVisibleRowsToListData();
    compactListData();

    listData.sort((a, b) =>
      String(a.id || "").localeCompare(String(b.id || ""), "ja", { numeric: true, sensitivity: "base" })
    );

    render();
  };

  document.getElementById("add-fertilizer-btn").onclick = () => {
    syncVisibleRowsToListData();

    listData.push({
      id: "",
      category: selectedCategory || "",
      name: "",
      capacity: null
    });

    render();
  };

  document.getElementById("save-btn").onclick = async () => {
    syncVisibleRowsToListData();
    compactListData();

    const newList = listData.map(v => ({
      id: normalizeFertilizerId(v.id),
      category: String(v.category || "").trim(),
      name: String(v.name || "").trim(),
      capacity: v.capacity == null || v.capacity === "" ? null : Number(v.capacity)
    }));

    const errors = validateBeforeSave(newList);
    if (errors.length > 0) {
      alert(`保存できません。\n${errors.join("\n")}`);
      return;
    }

    showSaveModal("保存しています…");

    const savePath = "data/" + finalPath.replace(/^\/data\//, "");
    await saveJSON(savePath, newList);
    await syncFertilizerDetail(savePath, newList);

    completeSaveModal("保存が完了しました");
  };

  render();
}
