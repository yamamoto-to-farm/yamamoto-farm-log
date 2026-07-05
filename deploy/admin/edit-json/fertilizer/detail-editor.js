// admin/edit-json/card-edit-fertilizer-detail.js
import { loadJSON, saveJSON } from "/common/json.js?v=1";
import { showSaveModal, completeSaveModal } from "/common/save-modal.js?v=1";

const FERTILIZER_CATEGORIES = [
  "BB",
  "化成",
  "窒素肥料",
  "改良材",
  "堆肥",
  "液肥",
  "葉面散布剤",
  "BS資材"
];

function buildEmptyFertilizerDetail(name = "") {
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
  if (m) return `F${String(Number(m[1])).padStart(3, "0")}`;
  return raw;
}

function parseNumberOrThrow(raw, label, id) {
  const text = String(raw ?? "").trim();
  if (text === "") return 0;
  const n = Number(text);
  if (!Number.isFinite(n)) throw new Error(`${id} の${label}は数値で入力してください`);
  return n;
}

function parseOptionalNumberOrThrow(raw, label, id) {
  const text = String(raw ?? "").trim();
  if (text === "") return null;
  const n = Number(text);
  if (!Number.isFinite(n)) throw new Error(`${id} の${label}は数値で入力してください`);
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
  const candidates = ["/data/fertilizer/fertilizer-index.json", "/data/fertilizer-index.json"];
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

function parsePriceText(raw, id) {
  const out = {};
  const lines = String(raw || "").split("\n").map(v => v.trim()).filter(Boolean);
  for (const line of lines) {
    const sep = line.includes(":") ? ":" : (line.includes("：") ? "：" : null);
    if (!sep) throw new Error(`${id} の月別価格は「YYYY-MM: 金額」で入力してください`);
    const [monthRaw, ...rest] = line.split(sep);
    const month = String(monthRaw || "").trim();
    const priceRaw = rest.join(sep).trim();
    if (!month || !/^\d{4}-\d{2}$/.test(month)) throw new Error(`${id} の月別価格の月は YYYY-MM 形式で入力してください`);
    if (!priceRaw) throw new Error(`${id} の月別価格の金額が空です`);
    const n = Number(priceRaw);
    out[month] = Number.isNaN(n) ? priceRaw : n;
  }
  return out;
}

function normalizeIngredientRows(value) {
  const rows = Array.isArray(value) ? value : [];
  if (rows.length === 0) return [{ name: "", kind: "", concentrationPercent: "", source: "" }];
  return rows.map(row => ({
    name: String(row?.name || ""),
    kind: String(row?.kind || ""),
    concentrationPercent: row?.concentrationPercent == null ? "" : String(row.concentrationPercent),
    source: String(row?.source || "")
  }));
}

function normalizeApplicationRows(value) {
  const rows = Array.isArray(value) ? value : [];
  if (rows.length === 0) return [{ crop: "", timing: "", amountPer10a: "", method: "", note: "" }];
  return rows.map(row => ({
    crop: String(row?.crop || ""),
    timing: String(row?.timing || ""),
    amountPer10a: String(row?.amountPer10a || ""),
    method: String(row?.method || ""),
    note: String(row?.note || "")
  }));
}

function uniqueNonEmpty(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map(v => String(v || "").trim()).filter(Boolean)));
}

function roundNutrient(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

function detectNutrientType(row = {}) {
  const text = `${row?.name || ""} ${row?.kind || ""} ${row?.source || ""}`.toLowerCase();

  if (/(^|[^a-z])n([^a-z]|$)|窒素|アンモニア/.test(text)) return "n";
  if (/(^|[^a-z])p([^a-z]|$)|p2o5|りん|リン|燐|リン酸/.test(text)) return "p";
  if (/(^|[^a-z])k([^a-z]|$)|k2o|加里|カリ|カリウム|potash/.test(text)) return "k";

  return "";
}

function calcNpkFromIngredients(ingredients = []) {
  const totals = { n: 0, p: 0, k: 0 };

  (Array.isArray(ingredients) ? ingredients : []).forEach(row => {
    const key = detectNutrientType(row);
    if (!key) return;

    const val = Number(row?.concentrationPercent);
    if (!Number.isFinite(val)) return;
    totals[key] += val;
  });

  return {
    n: roundNutrient(totals.n),
    p: roundNutrient(totals.p),
    k: roundNutrient(totals.k)
  };
}

function toCanonicalFertilizerDetail(item = {}) {
  const ingredients = Array.isArray(item.ingredients) ? item.ingredients : [];
  const applications = Array.isArray(item.applications) ? item.applications : (Array.isArray(item.applicationGuidelines) ? item.applicationGuidelines : []);
  const npk = calcNpkFromIngredients(ingredients);

  const next = {
    ...buildEmptyFertilizerDetail(),
    ...item,
    name: String(item.name || "").trim(),
    maker: String(item.maker || "").trim(),
    n: npk.n,
    p: npk.p,
    k: npk.k,
    notes: String(item.notes || "").trim(),
    price: item.price && typeof item.price === "object" && !Array.isArray(item.price) ? item.price : {},
    ingredients,
    applications
  };
  next.activeIngredients = uniqueNonEmpty([...(Array.isArray(item.activeIngredients) ? item.activeIngredients : []), ...next.ingredients.map(v => v?.name)]);
  next.targetCrops = uniqueNonEmpty([...(Array.isArray(item.targetCrops) ? item.targetCrops : []), ...next.applications.map(v => v?.crop)]);
  return next;
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
    if (!/^F\d{3}$/.test(id)) errors.push(`ID ${id}: ID は FNNN 形式で入力してください（例: F001）。`);
    if (!String(item.name || "").trim()) errors.push(`ID ${id}: 名称は必須です。`);
    ["n", "p", "k"].forEach(key => {
      if (!Number.isFinite(Number(item[key]))) errors.push(`ID ${id}: ${key.toUpperCase()} は数値で入力してください。`);
    });
    if (!Array.isArray(item.ingredients)) errors.push(`ID ${id}: 成分情報は配列で入力してください。`);
    if (!Array.isArray(item.applications)) errors.push(`ID ${id}: 施用目安は配列で入力してください。`);
  });

  return errors;
}

export function renderEditCard({ json, container, finalPath }) {
  const title = document.getElementById("page-title");
  if (title) title.textContent = "肥料詳細情報（fertilizer-detail.json）";

  const params = new URLSearchParams(location.search);
  const initialPid = normalizeFertilizerId(params.get("pid") || "");

  const current = (json && typeof json === "object" && !Array.isArray(json)) ? json : {};
  let selectedCategory = "";
  let searchKeyword = "";
  let selectedId = initialPid || Object.keys(current).map(v => normalizeFertilizerId(v)).filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "ja", { numeric: true, sensitivity: "base" }))[0] || "";
  let categoryMap = {};
  let hasUnsavedChanges = false;

  container.insertAdjacentHTML("beforeend", `
    <div class="card" style="margin-bottom:12px;">
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button id="go-fertilizer-index-btn" class="secondary-btn" type="button">肥料基本情報へ</button>
      </div>
    </div>

    <div class="card" style="margin-bottom:12px;">
      <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:end;">
        <div>
          <label class="form-label">カテゴリフィルタ</label>
          <select id="fert-detail-category-filter" class="form-input" style="min-width:220px;"></select>
        </div>
        <div>
          <label class="form-label">検索（ID/名称）</label>
          <input id="fert-detail-search" class="form-input" style="min-width:240px;" placeholder="F001 / 苦土 など">
        </div>
        <div>
          <label class="form-label">編集対象</label>
          <select id="fert-detail-target" class="form-input" style="min-width:260px;"></select>
        </div>
      </div>
      <div id="fert-detail-visible-count" style="margin-top:8px; color:#555;"></div>
    </div>

    <div id="fertilizer-editor"></div>

    <button id="save-btn" class="primary-btn" style="margin-top:20px;">保存する</button>
  `);

  const backBtn = document.getElementById("go-fertilizer-index-btn");
  const categoryEl = document.getElementById("fert-detail-category-filter");
  const searchEl = document.getElementById("fert-detail-search");
  const targetEl = document.getElementById("fert-detail-target");
  const countEl = document.getElementById("fert-detail-visible-count");
  const editorEl = document.getElementById("fertilizer-editor");

  const getCategoryById = id => String(categoryMap[normalizeFertilizerId(id)] || "").trim();

  function updateBackButton() {
    if (!backBtn) return;
    const q = new URLSearchParams();
    q.set("data", "fertilizer-index");
    if (selectedId) q.set("pid", selectedId);
    backBtn.onclick = () => {
      location.href = `?${q.toString()}`;
    };
  }

  function refreshCategoryOptions() {
    const categories = new Set(FERTILIZER_CATEGORIES);
    sortedIds().forEach(id => {
      const cat = String(getCategoryById(id) || "").trim();
      if (cat) categories.add(cat);
    });

    const options = ["", ...Array.from(categories)];
    categoryEl.innerHTML = options
      .map(v => `<option value="${escapeHtml(v)}">${v ? escapeHtml(v) : "全カテゴリ"}</option>`)
      .join("");
    categoryEl.value = selectedCategory;
  }

  function categoryFilteredIds() {
    if (!selectedCategory) return sortedIds();
    return sortedIds().filter(id => String(getCategoryById(id) || "").trim() === selectedCategory);
  }

  function sortedIds() {
    return Object.keys(current).map(v => normalizeFertilizerId(v)).filter(Boolean)
      .sort((a, b) => a.localeCompare(b, "ja", { numeric: true, sensitivity: "base" }));
  }

  function filteredIdsByKeyword(keyword) {
    const q = String(keyword || "").trim().toLowerCase();
    const base = categoryFilteredIds();
    if (!q) return base;
    return base.filter(id => {
      const name = String(current[id]?.name || "").toLowerCase();
      return id.toLowerCase().includes(q) || name.includes(q);
    });
  }

  function filteredIds() {
    return filteredIdsByKeyword(searchKeyword);
  }

  function confirmDiscardChanges() {
    if (!hasUnsavedChanges) return true;
    return confirm("保存していない変更があります。破棄して続行しますか？");
  }

  function refreshTargetOptions() {
    const ids = filteredIds();
    targetEl.innerHTML = ids.map(id => {
      const name = String(current[id]?.name || "").trim();
      return `<option value="${id}">${escapeHtml(id)}${name ? ` - ${escapeHtml(name)}` : ""}</option>`;
    }).join("");
    if (!ids.includes(selectedId)) selectedId = ids[0] || "";
    if (selectedId) targetEl.value = selectedId;
    if (countEl) countEl.textContent = `検索結果 ${ids.length} 件 / 全体 ${Object.keys(current).length} 件`;
  }

  function renderEditor() {
    editorEl.innerHTML = "";
    if (!selectedId) {
      hasUnsavedChanges = false;
      editorEl.innerHTML = `<div class="card"><p style="margin:0; color:#666;">対象がありません。カテゴリ・検索条件・一覧選択を見直してください。</p></div>`;
      return;
    }

    const id = selectedId;
    const f = toCanonicalFertilizerDetail(current[id] || {});
    const ingredientRows = normalizeIngredientRows(f.ingredients);
    const applicationRows = normalizeApplicationRows(f.applications);
    const category = getCategoryById(id);

    editorEl.insertAdjacentHTML("beforeend", `
      <div class="card fertilizer-detail-card" data-id="${escapeHtml(id)}" style="margin-bottom:20px;">
        <h3>${escapeHtml(id)}</h3>
        <p style="margin:0 0 8px; color:#666;">カテゴリ: ${escapeHtml(category || "未設定")}</p>

        <div class="edit-line"><label>名称</label><input class="form-input" data-key="name" value="${escapeHtml(f.name || "")}"></div>
        <div class="edit-line"><label>メーカー</label><input class="form-input" data-key="maker" value="${escapeHtml(f.maker || "")}"></div>
        <div class="edit-line">
          <label>N / P / K（成分情報から自動算出）</label>
          <div style="display:flex; gap:10px;">
            <input class="form-input" data-key="n" type="number" step="any" value="${f.n ?? 0}" readonly>
            <input class="form-input" data-key="p" type="number" step="any" value="${f.p ?? 0}" readonly>
            <input class="form-input" data-key="k" type="number" step="any" value="${f.k ?? 0}" readonly>
          </div>
        </div>
        <div class="edit-line"><label>月別価格（YYYY-MM: 値）</label><textarea class="form-input" data-key="priceText" rows="4" placeholder="2026-07: 2500">${escapeHtml(priceToText(f.price))}</textarea></div>
        <div class="edit-line"><label>メモ</label><textarea class="form-input" data-key="notes" rows="2">${escapeHtml(f.notes || "")}</textarea></div>

        <div class="edit-line">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;"><label style="margin:0;">成分情報（1行1レコード）</label><button type="button" class="secondary-btn" data-action="add-ingredient">成分行を追加</button></div>
          <div style="display:grid; gap:6px; margin-top:8px;">
            ${ingredientRows.map((row, i) => `
              <div class="ingredient-row" data-index="${i}" style="display:grid; grid-template-columns: 1.2fr 1fr 0.9fr 1.2fr auto; gap:6px; align-items:center;">
                <input class="form-input" data-field="name" placeholder="成分名" value="${escapeHtml(row.name)}">
                <input class="form-input" data-field="kind" placeholder="区分（保証成分など）" value="${escapeHtml(row.kind)}">
                <input class="form-input" data-field="concentrationPercent" type="number" step="any" placeholder="含有率%" value="${escapeHtml(row.concentrationPercent)}">
                <input class="form-input" data-field="source" placeholder="備考/由来" value="${escapeHtml(row.source)}">
                <button type="button" class="secondary-btn" data-action="remove-ingredient" data-index="${i}">削除</button>
              </div>
            `).join("")}
          </div>
        </div>

        <div class="edit-line">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;"><label style="margin:0;">施用目安（1行1レコード）</label><button type="button" class="secondary-btn" data-action="add-application">施用行を追加</button></div>
          <div style="display:grid; gap:6px; margin-top:8px;">
            ${applicationRows.map((row, i) => `
              <div class="application-row" data-index="${i}" style="display:grid; grid-template-columns: 1fr 1fr 1fr 1fr 1fr auto; gap:6px; align-items:center;">
                <input class="form-input" data-field="crop" placeholder="作物" value="${escapeHtml(row.crop)}">
                <input class="form-input" data-field="timing" placeholder="時期" value="${escapeHtml(row.timing)}">
                <input class="form-input" data-field="amountPer10a" placeholder="10a当たり" value="${escapeHtml(row.amountPer10a)}">
                <input class="form-input" data-field="method" placeholder="施用方法" value="${escapeHtml(row.method)}">
                <input class="form-input" data-field="note" placeholder="備考" value="${escapeHtml(row.note)}">
                <button type="button" class="secondary-btn" data-action="remove-application" data-index="${i}">削除</button>
              </div>
            `).join("")}
          </div>
        </div>
      </div>
    `);

    const card = editorEl.querySelector(".fertilizer-detail-card");
    card?.addEventListener("click", e => {
      const btn = e.target.closest("button[data-action]");
      if (!btn) return;
      const action = btn.dataset.action;
      if (!action) return;
      e.preventDefault();

      try {
        syncSelectedFromInputs();
      } catch (err) {
        alert(err.message || "入力形式を確認してください");
        return;
      }

      if (action === "add-ingredient") {
        const nextRows = normalizeIngredientRows(current[selectedId]?.ingredients);
        nextRows.push({ name: "", kind: "", concentrationPercent: "", source: "" });
        current[selectedId].ingredients = nextRows;
        hasUnsavedChanges = true;
        renderEditor();
        return;
      }
      if (action === "remove-ingredient") {
        const idx = Number(btn.dataset.index);
        const nextRows = normalizeIngredientRows(current[selectedId]?.ingredients);
        if (Number.isInteger(idx) && idx >= 0 && idx < nextRows.length) {
          nextRows.splice(idx, 1);
          current[selectedId].ingredients = nextRows.length > 0 ? nextRows : [];
          hasUnsavedChanges = true;
          renderEditor();
        }
        return;
      }
      if (action === "add-application") {
        const nextRows = normalizeApplicationRows(current[selectedId]?.applications);
        nextRows.push({ crop: "", timing: "", amountPer10a: "", method: "", note: "" });
        current[selectedId].applications = nextRows;
        hasUnsavedChanges = true;
        renderEditor();
        return;
      }
      if (action === "remove-application") {
        const idx = Number(btn.dataset.index);
        const nextRows = normalizeApplicationRows(current[selectedId]?.applications);
        if (Number.isInteger(idx) && idx >= 0 && idx < nextRows.length) {
          nextRows.splice(idx, 1);
          current[selectedId].applications = nextRows.length > 0 ? nextRows : [];
          hasUnsavedChanges = true;
          renderEditor();
        }
      }
    });

    card?.querySelectorAll("input, textarea, select").forEach(el => {
      el.addEventListener("input", () => { hasUnsavedChanges = true; });
      el.addEventListener("change", () => { hasUnsavedChanges = true; });
    });

    hasUnsavedChanges = false;
  }

  function render() {
    refreshCategoryOptions();
    refreshTargetOptions();
    updateBackButton();
    renderEditor();
  }

  function syncSelectedFromInputs() {
    if (!selectedId) return;
    const card = editorEl.querySelector(".fertilizer-detail-card");
    if (!card) return;

    const id = normalizeFertilizerId(card.dataset.id || selectedId);
    if (!id) return;
    const getValue = key => card.querySelector(`[data-key="${key}"]`)?.value ?? "";
    const prev = toCanonicalFertilizerDetail(current[id] || buildEmptyFertilizerDetail());

    const next = {
      ...buildEmptyFertilizerDetail(),
      ...prev,
      name: getValue("name").trim(),
      maker: getValue("maker").trim(),
      price: parsePriceText(getValue("priceText"), id),
      notes: getValue("notes").trim()
    };

    const ingredients = Array.from(card.querySelectorAll(".ingredient-row")).map(row => {
      const getRowValue = field => row.querySelector(`[data-field="${field}"]`)?.value ?? "";
      const name = getRowValue("name").trim();
      const kind = getRowValue("kind").trim();
      const concentrationPercentRaw = getRowValue("concentrationPercent").trim();
      const source = getRowValue("source").trim();
      if (!name && !kind && !concentrationPercentRaw && !source) return null;
      const out = { name, kind };
      if (concentrationPercentRaw !== "") out.concentrationPercent = parseOptionalNumberOrThrow(concentrationPercentRaw, "成分情報の含有率", id);
      if (source) out.source = source;
      return out;
    }).filter(Boolean);

    const applications = Array.from(card.querySelectorAll(".application-row")).map(row => {
      const getRowValue = field => row.querySelector(`[data-field="${field}"]`)?.value ?? "";
      const crop = getRowValue("crop").trim();
      const timing = getRowValue("timing").trim();
      const amountPer10a = getRowValue("amountPer10a").trim();
      const method = getRowValue("method").trim();
      const note = getRowValue("note").trim();
      if (!crop && !timing && !amountPer10a && !method && !note) return null;
      const out = { crop, timing, amountPer10a, method };
      if (note) out.note = note;
      return out;
    }).filter(Boolean);

    next.ingredients = ingredients;
    next.applications = applications;
    current[id] = toCanonicalFertilizerDetail(next);
  }

  function syncNpkPreviewFromIngredientRows() {
    const card = editorEl.querySelector(".fertilizer-detail-card");
    if (!card) return;

    const ingredients = Array.from(card.querySelectorAll(".ingredient-row")).map(row => {
      const getRowValue = field => row.querySelector(`[data-field="${field}"]`)?.value ?? "";
      return {
        name: getRowValue("name").trim(),
        kind: getRowValue("kind").trim(),
        concentrationPercent: getRowValue("concentrationPercent").trim(),
        source: getRowValue("source").trim()
      };
    });

    const npk = calcNpkFromIngredients(ingredients);
    const nEl = card.querySelector('[data-key="n"]');
    const pEl = card.querySelector('[data-key="p"]');
    const kEl = card.querySelector('[data-key="k"]');
    if (nEl) nEl.value = String(npk.n);
    if (pEl) pEl.value = String(npk.p);
    if (kEl) kEl.value = String(npk.k);
  }

  categoryEl.onchange = () => {
    const nextCategory = categoryEl.value || "";
    const nextIds = filteredIdsByKeyword(searchKeyword).filter(id => {
      if (!nextCategory) return true;
      return String(getCategoryById(id) || "").trim() === nextCategory;
    });
    const nextSelected = nextIds.includes(selectedId) ? selectedId : (nextIds[0] || "");

    if (nextSelected !== selectedId && !confirmDiscardChanges()) {
      categoryEl.value = selectedCategory;
      return;
    }

    selectedCategory = nextCategory;
    render();
  };

  searchEl.oninput = () => {
    const nextKeyword = searchEl.value || "";
    const nextIds = filteredIdsByKeyword(nextKeyword);
    const nextSelected = nextIds.includes(selectedId) ? selectedId : (nextIds[0] || "");
    if (nextSelected !== selectedId && !confirmDiscardChanges()) {
      searchEl.value = searchKeyword;
      return;
    }
    searchKeyword = nextKeyword;
    render();
  };

  targetEl.onchange = () => {
    const nextId = normalizeFertilizerId(targetEl.value || "");
    if (nextId === selectedId) return;
    if (!confirmDiscardChanges()) {
      targetEl.value = selectedId;
      return;
    }
    selectedId = nextId;
    updateBackButton();
    renderEditor();
  };

  document.getElementById("save-btn").onclick = async () => {
    try {
      syncSelectedFromInputs();
    } catch (e) {
      alert(e.message || "入力形式を確認してください");
      return;
    }

    const normalized = {};
    Object.keys(current).forEach(id => {
      normalized[id] = toCanonicalFertilizerDetail(current[id]);
    });

    const errors = validateBeforeSave(normalized);
    if (errors.length > 0) {
      alert(`保存できません。\n${errors.join("\n")}`);
      return;
    }

    showSaveModal("保存しています…");
    const savePath = "data/" + finalPath.replace(/^\/data\//, "");
    await saveJSON(savePath, normalized);
    completeSaveModal("保存が完了しました");
    hasUnsavedChanges = false;
  };

  (async () => {
    categoryMap = await loadFertilizerIndexCategoryMap();
    render();

    editorEl.addEventListener("input", e => {
      if (!e.target?.closest?.(".ingredient-row")) return;
      syncNpkPreviewFromIngredientRows();
    });
  })();
}
