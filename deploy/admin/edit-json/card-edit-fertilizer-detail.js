// admin/edit-json/card-edit-fertilizer-detail.js
import { loadJSON, saveJSON } from "/common/json.js?v=1";
import { showSaveModal, completeSaveModal } from "/common/save-modal.js?v=1";

const FERTILIZER_CATEGORIES = ["BB", "化成", "窒素肥料", "改良材", "堆肥", "土壌消毒剤"];

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function priceToText(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";

  return Object.entries(value)
    .map(([month, price]) => `${month}: ${price}`)
    .join("\n");
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

function parseNumberOrThrow(raw, label, id) {
  const text = String(raw ?? "").trim();
  if (text === "") return 0;
  const n = Number(text);
  if (!Number.isFinite(n)) {
    throw new Error(`${id} の${label}は数値で入力してください`);
  }
  return n;
}

function buildFertilizerIdSuggestions(ids, maxCount = 40) {
  const existing = new Set(ids.map(v => normalizeFertilizerId(v)).filter(Boolean));
  const out = [];

  for (let i = 1; i <= 999 && out.length < maxCount; i += 1) {
    const id = `F${String(i).padStart(3, "0")}`;
    if (!existing.has(id)) out.push(id);
  }

  return out;
}

async function loadFertilizerIndexCategoryMap() {
  const candidates = [
    "/data/fertilizer/fertilizer-index.json",
    "/data/fertilizer-index.json"
  ];

  for (const p of candidates) {
    try {
      const list = await loadJSON(`${p}?ts=${Date.now()}`);
      if (!Array.isArray(list)) continue;

      const out = {};
      list.forEach(item => {
        const id = normalizeFertilizerId(item?.id || "");
        if (!id) return;
        out[id] = String(item?.category || "").trim();
      });
      return out;
    } catch {
      // 次候補へ
    }
  }

  return {};
}

function validateBeforeSave(data) {
  const errors = [];
  const ids = Object.keys(data);

  if (ids.length === 0) {
    errors.push("保存対象がありません。1件以上入力してください。");
    return errors;
  }

  ids.forEach(id => {
    const item = data[id] || {};
    const name = String(item.name || "").trim();

    if (!/^F\d{3}$/.test(id)) {
      errors.push(`ID ${id}: ID は FNNN 形式で入力してください（例: F001）。`);
    }
    if (!name) {
      errors.push(`ID ${id}: 名称は必須です。`);
    }

    ["n", "p", "k"].forEach(key => {
      const n = Number(item[key]);
      if (!Number.isFinite(n)) {
        errors.push(`ID ${id}: ${key.toUpperCase()} は数値で入力してください。`);
      }
    });
  });

  return errors;
}

function parsePriceText(raw, id) {
  const out = {};
  const lines = String(raw || "")
    .split("\n")
    .map(v => v.trim())
    .filter(Boolean);

  for (const line of lines) {
    const sep = line.includes(":") ? ":" : (line.includes("：") ? "：" : null);
    if (!sep) {
      throw new Error(`${id} の月別価格は「YYYY-MM: 金額」で入力してください`);
    }

    const [monthRaw, ...rest] = line.split(sep);
    const month = String(monthRaw || "").trim();
    const priceRaw = rest.join(sep).trim();

    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      throw new Error(`${id} の月別価格の月は YYYY-MM 形式で入力してください`);
    }
    if (!priceRaw) {
      throw new Error(`${id} の月別価格の金額が空です`);
    }

    const n = Number(priceRaw);
    out[month] = Number.isNaN(n) ? priceRaw : n;
  }

  return out;
}

export function renderEditCard({ dataName, json, container, finalPath }) {

  // タイトル
  const title = document.getElementById("page-title");
  if (title) title.textContent = "肥料詳細情報（fertilizer-detail.json）";

  let selectedCategory = "";
  let categoryMap = {};

  container.insertAdjacentHTML("beforeend", `
    <div class="card" style="margin-bottom:12px;">
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button class="secondary-btn" type="button" onclick="location.href='?data=fertilizer-index'">肥料基本情報へ</button>
      </div>
    </div>

    <div class="card" style="margin-bottom:12px;">
      <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:end;">
        <div>
          <label class="form-label">カテゴリフィルタ</label>
          <select id="fert-detail-category-filter" class="form-input" style="min-width:200px;"></select>
        </div>
        <div>
          <label class="form-label">ID候補（未使用）</label>
          <select id="fert-detail-id-candidate" class="form-input" style="min-width:180px;"></select>
        </div>
        <button id="add-fert-detail-from-candidate" class="secondary-btn" type="button">候補IDで追加</button>
      </div>
      <div id="fert-detail-visible-count" style="margin-top:8px; color:#555;"></div>
    </div>

    <div id="fertilizer-list"></div>

    <button id="sort-fertilizer-detail-btn" class="secondary-btn" style="margin-top:12px;">
      ID順に並び替え
    </button>

    <button id="add-fertilizer-btn" class="primary-btn" style="margin-top:20px;">
      ＋ 肥料を追加
    </button>

    <button id="save-btn" class="primary-btn" style="margin-top:20px;">
      保存する
    </button>
  `);

  const list = document.getElementById("fertilizer-list");
  const filterEl = document.getElementById("fert-detail-category-filter");
  const candidateEl = document.getElementById("fert-detail-id-candidate");
  const countEl = document.getElementById("fert-detail-visible-count");

  function getCategoryById(id) {
    return String(categoryMap[normalizeFertilizerId(id)] || "").trim();
  }

  function getVisibleIds() {
    const ids = Object.keys(json)
      .map(v => normalizeFertilizerId(v))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, "ja", { numeric: true, sensitivity: "base" }));

    return ids.filter(id => {
      if (!selectedCategory) return true;
      return getCategoryById(id) === selectedCategory;
    });
  }

  function refreshFilterOptions() {
    const catSet = new Set(FERTILIZER_CATEGORIES);
    Object.keys(json).forEach(id => {
      const cat = getCategoryById(id);
      if (cat) catSet.add(cat);
    });

    const options = ["", ...Array.from(catSet)];
    filterEl.innerHTML = options
      .map(v => `<option value="${escapeHtml(v)}">${v ? escapeHtml(v) : "全カテゴリ"}</option>`)
      .join("");
    filterEl.value = selectedCategory;
  }

  function refreshIdSuggestions() {
    const suggestions = buildFertilizerIdSuggestions(Object.keys(json), 40);
    candidateEl.innerHTML = suggestions.map(v => `<option value="${v}">${v}</option>`).join("");
  }

  // -----------------------------
  // レンダリング
  // -----------------------------
  function render() {
    list.innerHTML = "";
    refreshFilterOptions();
    refreshIdSuggestions();

    const ids = getVisibleIds();
    if (countEl) {
      countEl.textContent = `表示中 ${ids.length} 件 / 全体 ${Object.keys(json).length} 件`;
    }

    ids.forEach(id => {
      const f = json[id] || {};
      const category = getCategoryById(id);

      list.insertAdjacentHTML("beforeend", `
        <div class="card fertilizer-detail-card" data-id="${escapeHtml(id)}" style="margin-bottom:20px;">
          <h3>${escapeHtml(id)}</h3>
          <p style="margin:0 0 8px; color:#666;">カテゴリ: ${escapeHtml(category || "未設定")}</p>

          <div class="edit-line">
            <label>名称</label>
            <input class="form-input" data-id="${escapeHtml(id)}" data-key="name" value="${escapeHtml(f.name || "")}">
          </div>

          <div class="edit-line">
            <label>メーカー</label>
            <input class="form-input" data-id="${escapeHtml(id)}" data-key="maker" value="${escapeHtml(f.maker || "")}">
          </div>

          <div class="edit-line">
            <label>N / P / K</label>
            <div style="display:flex; gap:10px;">
              <input class="form-input" data-id="${escapeHtml(id)}" data-key="n" type="number" step="any" value="${f.n ?? 0}">
              <input class="form-input" data-id="${escapeHtml(id)}" data-key="p" type="number" step="any" value="${f.p ?? 0}">
              <input class="form-input" data-id="${escapeHtml(id)}" data-key="k" type="number" step="any" value="${f.k ?? 0}">
            </div>
          </div>

          <div class="edit-line">
            <label>月別価格（YYYY-MM: 値）</label>
            <textarea class="form-input" data-id="${escapeHtml(id)}" data-key="priceText" rows="4" placeholder="2026-07: 2500">${escapeHtml(priceToText(f.price))}</textarea>
          </div>

          <div class="edit-line">
            <label>メモ</label>
            <textarea class="form-input" data-id="${escapeHtml(id)}" data-key="notes" rows="2">${escapeHtml(f.notes || "")}</textarea>
          </div>
        </div>
      `);
    });
  }

  function syncVisibleFromInputs() {
    const cards = container.querySelectorAll(".fertilizer-detail-card");

    cards.forEach(card => {
      const id = normalizeFertilizerId(card.dataset.id || "");
      if (!id) return;
      const getValue = key => card.querySelector(`[data-key=\"${key}\"]`)?.value ?? "";

      json[id] = {
        ...(json[id] || {}),
        name: getValue("name").trim(),
        maker: getValue("maker").trim(),
        n: parseNumberOrThrow(getValue("n"), "N", id),
        p: parseNumberOrThrow(getValue("p"), "P", id),
        k: parseNumberOrThrow(getValue("k"), "K", id),
        price: parsePriceText(getValue("priceText"), id),
        notes: getValue("notes").trim()
      };
    });
  }

  filterEl.onchange = () => {
    try {
      syncVisibleFromInputs();
    } catch (e) {
      alert(e.message || "入力形式を確認してください");
      return;
    }
    selectedCategory = filterEl.value || "";
    render();
  };

  document.getElementById("add-fert-detail-from-candidate").onclick = () => {
    try {
      syncVisibleFromInputs();
    } catch (e) {
      alert(e.message || "入力形式を確認してください");
      return;
    }

    const candidate = normalizeFertilizerId(candidateEl.value || "");
    if (!candidate) return;

    if (json[candidate]) {
      alert(`ID ${candidate} は既に存在します。`);
      return;
    }

    json[candidate] = {
      name: "",
      maker: "",
      price: {},
      n: 0,
      p: 0,
      k: 0,
      notes: ""
    };

    render();
  };

  render();

  document.getElementById("sort-fertilizer-detail-btn").onclick = () => {
    try {
      syncVisibleFromInputs();
    } catch (e) {
      alert(e.message || "入力形式を確認してください");
      return;
    }

    const sorted = {};
    Object.keys(json)
      .sort((a, b) => a.localeCompare(b, "ja", { numeric: true, sensitivity: "base" }))
      .forEach(id => {
        sorted[id] = json[id];
      });

    json = sorted;
    render();
  };

  // -----------------------------
  // 肥料追加
  // -----------------------------
  document.getElementById("add-fertilizer-btn").onclick = () => {
    try {
      syncVisibleFromInputs();
    } catch (e) {
      alert(e.message || "入力形式を確認してください");
      return;
    }

    const ids = Object.keys(json).map(v => normalizeFertilizerId(v));
    const suggestion = buildFertilizerIdSuggestions(ids, 1)[0];
    const newId = suggestion || "F001";

    json[newId] = {
      name: "",
      maker: "",
      price: {},
      n: 0,
      p: 0,
      k: 0,
      notes: ""
    };
    render();
  };

  // -----------------------------
  // 保存処理
  // -----------------------------
  document.getElementById("save-btn").onclick = async () => {
    try {
      syncVisibleFromInputs();
    } catch (e) {
      alert(e.message || "入力形式を確認してください");
      return;
    }

    const errors = validateBeforeSave(json);
    if (errors.length > 0) {
      alert(`保存できません。\n${errors.join("\n")}`);
      return;
    }

    showSaveModal("保存しています…");

    const savePath = "data/" + finalPath.replace(/^\/data\//, "");
    await saveJSON(savePath, json);

    completeSaveModal("保存が完了しました");
  };

  (async () => {
    categoryMap = await loadFertilizerIndexCategoryMap();
    render();
  })();
}
