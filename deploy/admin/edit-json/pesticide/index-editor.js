// admin/edit-json/card-edit-pesticide-index.js
import { loadJSON, saveJSON } from "/common/json.js?v=1";
import { showSaveModal, completeSaveModal } from "/common/save-modal.js?v=1";

const PESTICIDE_CATEGORIES = [
  "殺菌剤",
  "殺虫剤",
  "茎葉除草剤",
  "選択制除草剤",
  "展着剤",
  "土壌消毒剤"
];

const PESTICIDE_PREFIXES = [
  { prefix: "FG", category: "殺菌剤" },
  { prefix: "IN", category: "殺虫剤" },
  { prefix: "HL", category: "茎葉除草剤" },
  { prefix: "SL", category: "選択制除草剤" },
  { prefix: "AD", category: "展着剤" },
  { prefix: "SD", category: "土壌消毒剤" }
];

function createEmptyPesticideDetail(item = {}) {
  return {
    name: item.name || "",
    maker: "",
    category: item.category || "",
    unit: item.unit || "ml",
    registrationNo: "",
    formulation: "",
    price: {},
    dilution: {
      min: null,
      max: null,
      default: null
    },
    standardDose: {
      per10a: null,
      unit: item.unit || "ml"
    },
    packaging: {
      amountPerPack: null,
      unit: item.unit || "ml",
      packLabel: "本"
    },
    ingredients: [],
    applications: [],
    activeIngredients: [],
    targetCrops: [],
    targetPests: [],
    maxApplicationsPerSeason: null,
    preHarvestIntervalDays: null,
    reentryIntervalHours: null,
    resistanceCode: "",
    notes: ""
  };
}

function toDetailPath(indexSavePath) {
  return indexSavePath.replace(/-index\.json$/, "-detail.json");
}

async function syncPesticideDetail(indexSavePath, indexList) {
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
      ...createEmptyPesticideDetail(item),
      ...prev,
      name: item.name || prev.name || "",
      category: item.category || prev.category || "",
      unit: item.unit || prev.unit || "ml"
    };
  });

  await saveJSON(detailSavePath, nextDetail);
}

function normalizePesticideId(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return "";

  const m = raw.match(/^([A-Z]{2})(\d{1,4})$/);
  if (m) {
    return `${m[1]}${String(Number(m[2])).padStart(4, "0")}`;
  }

  return raw;
}

function buildPesticideIdSuggestions(list, perPrefix = 8, categoryFilter = "") {
  const existing = list
    .map(v => normalizePesticideId(v?.id || ""))
    .filter(Boolean);

  const existingSet = new Set(existing);
  const out = [];
  const category = String(categoryFilter || "").trim();

  const targets = category
    ? PESTICIDE_PREFIXES.filter(v => v.category === category)
    : PESTICIDE_PREFIXES;

  // 未定義カテゴリを選択中の場合は候補ゼロより全件表示の方が実用的
  const prefixTargets = targets.length > 0 ? targets : PESTICIDE_PREFIXES;

  prefixTargets.forEach(({ prefix, category: labelCategory }) => {
    let found = 0;
    for (let n = 1; n <= 9999 && found < perPrefix; n++) {
      const id = `${prefix}${String(n).padStart(4, "0")}`;
      if (existingSet.has(id)) continue;
      out.push({ id, label: `${id} (${labelCategory})` });
      found += 1;
    }
  });

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
  if (title) title.textContent = "農薬基本情報（pesticide-index.json）";

  let listData = Array.isArray(json)
    ? json.map(v => ({ ...v }))
    : Object.values(json || {}).map(v => ({ ...v }));

  let selectedCategory = "";

  container.insertAdjacentHTML("beforeend", `
    <div class="card">
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px;">
        <button class="secondary-btn" type="button" onclick="location.href='?data=pesticide-detail'">農薬詳細情報へ</button>
      </div>

      <h2>農薬一覧</h2>

      <div class="sub-card" style="margin-bottom:14px; background:#f8fbff; border:1px solid #dbeafe;">
        <p style="margin:0 0 6px;"><strong>入力ルール（README抜粋）</strong></p>
        <p style="margin:0 0 4px;">ID: <strong>CCNNNN</strong> または <strong>FNNN</strong> 形式（例: FG0001 / F304）</p>
        <p style="margin:0 0 4px;">カテゴリ: 殺菌剤 / 殺虫剤 / 茎葉除草剤 / 選択制除草剤 / 展着剤 / 土壌消毒剤</p>
        <p style="margin:0; font-size:0.92em; color:#555;">プレフィックス例: FG=殺菌剤, IN=殺虫剤, HL=茎葉除草剤, SL=選択制除草剤, AD=展着剤, SD=土壌消毒剤</p>
      </div>

      <div class="sub-card" style="margin-bottom:14px;">
        <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:end;">
          <div>
            <label class="form-label">カテゴリフィルタ</label>
            <select id="pesticide-category-filter" class="form-input" style="min-width:220px;"></select>
          </div>
          <div>
            <label class="form-label">ID候補（未使用）</label>
            <select id="pesticide-id-candidate-select" class="form-input" style="min-width:240px;"></select>
          </div>
          <button id="add-pesticide-from-candidate" class="secondary-btn" type="button">候補IDで追加</button>
        </div>
        <div id="pesticide-visible-count" style="margin-top:8px; color:#555;"></div>
      </div>

      <datalist id="pesticide-id-datalist"></datalist>
      <div id="pesticide-list"></div>

      <button id="sort-pesticide-btn" class="secondary-btn" style="margin-top:12px;">
        ID順に並び替え
      </button>

      <button id="add-pesticide-btn" class="primary-btn" style="margin-top:20px;">
        ＋ 農薬を追加
      </button>

      <button id="save-btn" class="primary-btn" style="margin-top:20px;">
        保存する
      </button>
    </div>
  `);

  const listEl = document.getElementById("pesticide-list");
  const filterEl = document.getElementById("pesticide-category-filter");
  const candidateEl = document.getElementById("pesticide-id-candidate-select");
  const datalistEl = document.getElementById("pesticide-id-datalist");
  const countEl = document.getElementById("pesticide-visible-count");

  function normalizeRows() {
    listData = listData.map(v => ({
      id: normalizePesticideId(v.id || ""),
      name: String(v.name || "").trim(),
      category: String(v.category || "").trim(),
      unit: String(v.unit || "").trim()
    }));
  }

  function syncVisibleRowsToListData() {
    const ids = container.querySelectorAll(".pesticide-id");
    const names = container.querySelectorAll(".pesticide-name");
    const categories = container.querySelectorAll(".pesticide-category");
    const units = container.querySelectorAll(".pesticide-unit");

    ids.forEach((input, i) => {
      const idx = Number(input.dataset.index);
      if (!Number.isInteger(idx) || !listData[idx]) return;

      listData[idx] = {
        ...listData[idx],
        id: normalizePesticideId(input.value),
        name: names[i].value.trim(),
        category: categories[i].value.trim(),
        unit: units[i].value.trim()
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
    const catSet = new Set(PESTICIDE_CATEGORIES);
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
    const suggestions = buildPesticideIdSuggestions(listData, 8, selectedCategory);

    candidateEl.innerHTML = suggestions
      .map(v => `<option value="${v.id}">${escapeHtml(v.label)}</option>`)
      .join("");

    datalistEl.innerHTML = suggestions
      .map(v => `<option value="${v.id}"></option>`)
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
      const name = item.name ?? "";
      const category = item.category ?? "";
      const unit = item.unit ?? "";

      listEl.insertAdjacentHTML("beforeend", `
        <div class="sub-card" style="margin-bottom:12px;">
          <div class="form-row">
            <label class="form-label">ID</label>
            <input class="form-input pesticide-id" list="pesticide-id-datalist" data-index="${index}" value="${escapeHtml(id)}" placeholder="FG0001">
          </div>

          <div class="form-row">
            <label class="form-label">名称</label>
            <input class="form-input pesticide-name" data-index="${index}" value="${escapeHtml(name)}">
          </div>

          <div class="form-row">
            <label class="form-label">カテゴリ</label>
            <input class="form-input pesticide-category" data-index="${index}" value="${escapeHtml(category)}" placeholder="殺菌剤など">
          </div>

          <div class="form-row">
            <label class="form-label">単位</label>
            <input class="form-input pesticide-unit" data-index="${index}" value="${escapeHtml(unit)}" placeholder="ml / g など">
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

  function validateBeforeSave(rows) {
    const errors = [];
    const usedIds = new Set();

    if (rows.length === 0) {
      errors.push("保存対象がありません。1件以上入力してください。");
      return errors;
    }

    rows.forEach((row, i) => {
      const line = i + 1;
      const id = normalizePesticideId(row.id);
      const name = String(row.name || "").trim();
      const category = String(row.category || "").trim();
      const unit = String(row.unit || "").trim();

      if (!id) errors.push(`${line}行目: ID は必須です。`);
      if (id && !/^(?:[A-Z]{2}\d{4}|F\d{3})$/.test(id)) {
        errors.push(`${line}行目: ID は CCNNNN または FNNN 形式で入力してください（例: FG0001 / F304）。`);
      }
      if (id && usedIds.has(id)) {
        errors.push(`${line}行目: ID ${id} が重複しています。`);
      }
      if (id) usedIds.add(id);

      if (!name) errors.push(`${line}行目: 名称は必須です。`);
      if (!category) errors.push(`${line}行目: カテゴリは必須です。`);
      if (!unit) errors.push(`${line}行目: 単位は必須です。`);
    });

    return errors;
  }

  filterEl.onchange = () => {
    syncVisibleRowsToListData();
    selectedCategory = filterEl.value || "";
    render();
  };

  document.getElementById("add-pesticide-from-candidate").onclick = () => {
    syncVisibleRowsToListData();

    const candidate = String(candidateEl.value || "").trim();
    if (!candidate) return;

    const exists = listData.some(v => normalizePesticideId(v.id) === candidate);
    if (exists) {
      alert(`ID ${candidate} は既に存在します。`);
      return;
    }

    const info = PESTICIDE_PREFIXES.find(v => candidate.startsWith(v.prefix));

    if (selectedCategory && info?.category && info.category !== selectedCategory) {
      alert(`現在のカテゴリフィルタ（${selectedCategory}）に一致するID候補を選択してください。`);
      return;
    }

    listData.push({
      id: candidate,
      name: "",
      category: selectedCategory || info?.category || "",
      unit: "ml"
    });

    render();
  };

  document.getElementById("sort-pesticide-btn").onclick = () => {
    syncVisibleRowsToListData();
    compactListData();

    listData.sort((a, b) =>
      String(a.id || "").localeCompare(String(b.id || ""), "ja", { numeric: true, sensitivity: "base" })
    );

    render();
  };

  document.getElementById("add-pesticide-btn").onclick = () => {
    syncVisibleRowsToListData();

    listData.push({
      id: "",
      name: "",
      category: selectedCategory || "",
      unit: ""
    });

    render();
  };

  document.getElementById("save-btn").onclick = async () => {
    syncVisibleRowsToListData();
    compactListData();

    const newList = listData.map(v => ({
      id: normalizePesticideId(v.id),
      name: String(v.name || "").trim(),
      category: String(v.category || "").trim(),
      unit: String(v.unit || "").trim()
    }));

    const errors = validateBeforeSave(newList);
    if (errors.length > 0) {
      alert(`保存できません。\n${errors.join("\n")}`);
      return;
    }

    showSaveModal("保存しています…");

    const savePath = "data/" + finalPath.replace(/^\/data\//, "");
    await saveJSON(savePath, newList);
    await syncPesticideDetail(savePath, newList);

    completeSaveModal("保存が完了しました");
  };

  render();
}
