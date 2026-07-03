// admin/edit-json/card-edit-pesticide-detail.js
import { saveJSON } from "/common/json.js?v=1";
import { showSaveModal, completeSaveModal } from "/common/save-modal.js?v=1";

const PESTICIDE_CATEGORIES = ["殺菌剤", "殺虫剤", "茎葉除草剤", "選択制除草剤", "展着剤", "土壌消毒剤"];

const PESTICIDE_PREFIXES = [
  { prefix: "FG", category: "殺菌剤" },
  { prefix: "IN", category: "殺虫剤" },
  { prefix: "HL", category: "茎葉除草剤" },
  { prefix: "SL", category: "選択制除草剤" },
  { prefix: "AD", category: "展着剤" },
  { prefix: "SD", category: "土壌消毒剤" }
];

function buildEmptyPesticideDetail() {
  return {
    name: "",
    maker: "",
    category: "",
    unit: "ml",
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
      unit: "ml"
    },
    packaging: {
      amountPerPack: null,
      unit: "ml",
      packLabel: "本"
    },
    targetCrops: [],
    targetPests: [],
    activeIngredients: [],
    maxApplicationsPerSeason: null,
    preHarvestIntervalDays: null,
    reentryIntervalHours: null,
    resistanceCode: "",
    notes: "",
    ingredients: [],
    applications: []
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

function parseNullableNumber(raw) {
  const text = String(raw ?? "").trim();
  if (text === "") return null;
  const n = Number(text);
  if (Number.isNaN(n)) {
    throw new Error("数値項目に不正な値があります");
  }
  return n;
}

function parseOptionalNumberOrThrow(raw, label, id) {
  const text = String(raw ?? "").trim();
  if (text === "") return null;
  const n = Number(text);
  if (!Number.isFinite(n)) {
    throw new Error(`${id} の${label}は数値で入力してください`);
  }
  return n;
}

function normalizeIngredientRows(value) {
  const rows = Array.isArray(value) ? value : [];
  if (rows.length === 0) {
    return [{ name: "", kind: "", concentrationPercent: "", resistanceScheme: "", resistanceCode: "", source: "" }];
  }

  return rows.map(row => {
    const concentration = row?.concentrationPercent;
    return {
      name: String(row?.name || ""),
      kind: String(row?.kind || ""),
      concentrationPercent: concentration == null ? "" : String(concentration),
      resistanceScheme: String(row?.resistance?.scheme || ""),
      resistanceCode: String(row?.resistance?.code || ""),
      source: String(row?.source || "")
    };
  });
}

function normalizeApplicationRows(value) {
  const rows = Array.isArray(value) ? value : [];
  if (rows.length === 0) {
    return [{
      crop: "",
      target: "",
      dilution: "",
      sprayVolume: "",
      timing: "",
      maxProductApplications: "",
      method: "",
      maxActiveIngredientApplications: "",
      note: ""
    }];
  }

  return rows.map(row => ({
    crop: String(row?.crop || ""),
    target: String(row?.target || ""),
    dilution: String(row?.dilution || ""),
    sprayVolume: String(row?.sprayVolume || ""),
    timing: String(row?.timing || ""),
    maxProductApplications: row?.maxProductApplications == null ? "" : String(row.maxProductApplications),
    method: String(row?.method || ""),
    maxActiveIngredientApplications: row?.maxActiveIngredientApplications == null ? "" : String(row.maxActiveIngredientApplications),
    note: String(row?.note || "")
  }));
}

function uniqueNonEmpty(values) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map(v => String(v || "").trim())
    .filter(Boolean)));
}

function buildResistanceCodeFromIngredients(ingredients) {
  const parts = (Array.isArray(ingredients) ? ingredients : [])
    .map(row => {
      const scheme = String(row?.resistance?.scheme || "").trim().toUpperCase();
      const code = String(row?.resistance?.code || "").trim();
      if (!scheme || !code) return "";
      return `${scheme}:${code}`;
    })
    .filter(Boolean);
  return uniqueNonEmpty(parts).join(", ");
}

function toCanonicalPesticideDetail(item = {}) {
  const base = buildEmptyPesticideDetail();
  const next = {
    ...base,
    ...item,
    name: String(item.name || "").trim(),
    maker: String(item.maker || "").trim(),
    category: String(item.category || "").trim(),
    unit: String(item.unit || "ml").trim() || "ml",
    registrationNo: String(item.registrationNo || "").trim(),
    formulation: String(item.formulation || "").trim(),
    notes: String(item.notes || "").trim(),
    price: item.price && typeof item.price === "object" && !Array.isArray(item.price) ? item.price : {},
    dilution: {
      min: item.dilution?.min ?? null,
      max: item.dilution?.max ?? null,
      default: item.dilution?.default ?? null
    },
    standardDose: {
      per10a: item.standardDose?.per10a ?? null,
      unit: String(item.standardDose?.unit || item.unit || "ml").trim() || "ml"
    },
    packaging: {
      amountPerPack: item.packaging?.amountPerPack ?? null,
      unit: String(item.packaging?.unit || item.unit || "ml").trim() || "ml",
      packLabel: String(item.packaging?.packLabel || "本").trim() || "本"
    },
    maxApplicationsPerSeason: item.maxApplicationsPerSeason ?? null,
    preHarvestIntervalDays: item.preHarvestIntervalDays ?? null,
    reentryIntervalHours: item.reentryIntervalHours ?? null,
    ingredients: Array.isArray(item.ingredients) ? item.ingredients : [],
    applications: Array.isArray(item.applications) ? item.applications : []
  };

  next.activeIngredients = uniqueNonEmpty(
    next.ingredients.map(v => v?.name)
  );
  next.targetCrops = uniqueNonEmpty(
    next.applications.map(v => v?.crop)
  );
  next.targetPests = uniqueNonEmpty(
    next.applications.map(v => v?.target)
  );

  if (!next.resistanceCode) {
    next.resistanceCode = buildResistanceCodeFromIngredients(next.ingredients);
  } else {
    next.resistanceCode = String(next.resistanceCode || "").trim();
  }

  return next;
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

function buildPesticideIdSuggestions(ids, perPrefix = 8) {
  const existing = new Set(ids.map(v => normalizePesticideId(v)).filter(Boolean));
  const out = [];

  PESTICIDE_PREFIXES.forEach(({ prefix, category }) => {
    let found = 0;
    for (let n = 1; n <= 9999 && found < perPrefix; n += 1) {
      const id = `${prefix}${String(n).padStart(4, "0")}`;
      if (existing.has(id)) continue;
      out.push({ id, label: `${id} (${category})` });
      found += 1;
    }
  });

  return out;
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

    if (!/^(?:[A-Z]{2}\d{4}|F\d{3})$/.test(id)) {
      errors.push(`ID ${id}: ID は CCNNNN または FNNN 形式で入力してください（例: FG0001 / F304）。`);
    }
    if (!String(item.name || "").trim()) {
      errors.push(`ID ${id}: 名称は必須です。`);
    }
    if (!String(item.category || "").trim()) {
      errors.push(`ID ${id}: カテゴリは必須です。`);
    }
    if (!String(item.unit || "").trim()) {
      errors.push(`ID ${id}: 単位は必須です。`);
    }

    const min = item.dilution?.min;
    const max = item.dilution?.max;
    if (min != null && max != null && Number(min) > Number(max)) {
      errors.push(`ID ${id}: 希釈倍率は min <= max で入力してください。`);
    }

    const ingredients = Array.isArray(item.ingredients) ? item.ingredients : [];
    ingredients.forEach((row, i) => {
      const scheme = String(row?.resistance?.scheme || "").toUpperCase();
      if (scheme && !["IRAC", "FRAC", "HRAC"].includes(scheme)) {
        errors.push(`ID ${id}: ingredients[${i}] の resistance.scheme は IRAC/FRAC/HRAC のいずれかで入力してください。`);
      }
    });
  });

  return errors;
}

export function renderEditCard({ dataName, json, container, finalPath }) {
  const title = document.getElementById("page-title");
  if (title) title.textContent = "農薬詳細情報（pesticide-detail.json）";

  const current = (json && typeof json === "object" && !Array.isArray(json)) ? json : {};
  let searchKeyword = "";
  let selectedId = Object.keys(current)
    .map(v => normalizePesticideId(v))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "ja", { numeric: true, sensitivity: "base" }))[0] || "";
  let hasUnsavedChanges = false;

  container.insertAdjacentHTML("beforeend", `
    <div class="card" style="margin-bottom:12px;">
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button class="secondary-btn" type="button" onclick="location.href='?data=pesticide-index'">農薬基本情報へ</button>
      </div>
    </div>

    <div class="card" style="margin-bottom:12px;">
      <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:end;">
        <div>
          <label class="form-label">検索（ID/名称）</label>
          <input id="pesticide-detail-search" class="form-input" style="min-width:260px;" placeholder="FG0001 / アニキ など">
        </div>
        <div>
          <label class="form-label">編集対象</label>
          <select id="pesticide-detail-target" class="form-input" style="min-width:320px;"></select>
        </div>
        <div>
          <label class="form-label">新規ID候補（未使用）</label>
          <select id="pesticide-detail-id-candidate" class="form-input" style="min-width:220px;"></select>
        </div>
        <button id="add-pesticide-detail-from-candidate" class="secondary-btn" type="button">候補IDで追加</button>
        <button id="delete-pesticide-detail-btn" class="secondary-btn" type="button">選択中を削除</button>
      </div>
      <div id="pesticide-detail-visible-count" style="margin-top:8px; color:#555;"></div>
    </div>

    <div id="pesticide-detail-editor"></div>

    <button id="save-btn" class="primary-btn" style="margin-top:20px;">
      保存する
    </button>
  `);

  const searchEl = document.getElementById("pesticide-detail-search");
  const targetEl = document.getElementById("pesticide-detail-target");
  const candidateEl = document.getElementById("pesticide-detail-id-candidate");
  const countEl = document.getElementById("pesticide-detail-visible-count");
  const editorEl = document.getElementById("pesticide-detail-editor");

  function sortedIds() {
    return Object.keys(current)
      .map(v => normalizePesticideId(v))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, "ja", { numeric: true, sensitivity: "base" }));
  }

  function filteredIds() {
    const q = String(searchKeyword || "").trim().toLowerCase();
    if (!q) return sortedIds();

    return sortedIds().filter(id => {
      const item = current[id] || {};
      const name = String(item.name || "").toLowerCase();
      return id.toLowerCase().includes(q) || name.includes(q);
    });
  }

  function filteredIdsByKeyword(keyword) {
    const q = String(keyword || "").trim().toLowerCase();
    if (!q) return sortedIds();

    return sortedIds().filter(id => {
      const item = current[id] || {};
      const name = String(item.name || "").toLowerCase();
      return id.toLowerCase().includes(q) || name.includes(q);
    });
  }

  function confirmDiscardChanges() {
    if (!hasUnsavedChanges) return true;
    return confirm("保存していない変更があります。破棄して続行しますか？");
  }

  function refreshIdSuggestions() {
    const suggestions = buildPesticideIdSuggestions(Object.keys(current), 8);
    candidateEl.innerHTML = suggestions
      .map(v => `<option value="${v.id}">${escapeHtml(v.label)}</option>`)
      .join("");
  }

  function refreshTargetOptions() {
    const ids = filteredIds();

    targetEl.innerHTML = ids
      .map(id => {
        const name = String(current[id]?.name || "").trim();
        return `<option value="${id}">${escapeHtml(id)}${name ? ` - ${escapeHtml(name)}` : ""}</option>`;
      })
      .join("");

    if (!ids.includes(selectedId)) {
      selectedId = ids[0] || "";
    }
    if (selectedId) targetEl.value = selectedId;

    if (countEl) {
      countEl.textContent = `検索結果 ${ids.length} 件 / 全体 ${Object.keys(current).length} 件`;
    }
  }

  function renderEditor() {
    editorEl.innerHTML = "";

    if (!selectedId) {
      hasUnsavedChanges = false;
      editorEl.innerHTML = `
        <div class="card">
          <p style="margin:0; color:#666;">対象がありません。検索条件を変更するか、候補IDで新規追加してください。</p>
        </div>
      `;
      return;
    }

    const id = selectedId;
    const p = { ...buildEmptyPesticideDetail(), ...(current[id] || {}) };
    const ingredientRows = normalizeIngredientRows(p.ingredients);
    const applicationRows = normalizeApplicationRows(p.applications);

    editorEl.insertAdjacentHTML("beforeend", `
      <div class="card pesticide-detail-card" data-id="${escapeHtml(id)}" style="margin-bottom:20px;">
        <h3>${escapeHtml(id)}</h3>

        <div class="edit-line">
          <label>名称</label>
          <input class="form-input" data-id="${escapeHtml(id)}" data-key="name" value="${escapeHtml(p.name)}">
        </div>

        <div class="edit-line">
          <label>メーカー</label>
          <input class="form-input" data-id="${escapeHtml(id)}" data-key="maker" value="${escapeHtml(p.maker)}">
        </div>

        <div class="edit-line">
          <label>カテゴリ</label>
          <input class="form-input" data-id="${escapeHtml(id)}" data-key="category" value="${escapeHtml(p.category)}">
        </div>

        <div class="edit-line">
          <label>単位</label>
          <input class="form-input" data-id="${escapeHtml(id)}" data-key="unit" value="${escapeHtml(p.unit)}">
        </div>

        <div class="edit-line">
          <label>農薬登録番号</label>
          <input class="form-input" data-id="${escapeHtml(id)}" data-key="registrationNo" value="${escapeHtml(p.registrationNo)}">
        </div>

        <div class="edit-line">
          <label>剤型</label>
          <input class="form-input" data-id="${escapeHtml(id)}" data-key="formulation" value="${escapeHtml(p.formulation)}">
        </div>

        <div class="edit-line">
          <label>月別価格（YYYY-MM: 値）</label>
          <textarea class="form-input" data-id="${escapeHtml(id)}" data-key="priceText" rows="4" placeholder="2026-07: 2500">${escapeHtml(priceToText(p.price))}</textarea>
        </div>

        <div class="edit-line">
          <label>希釈倍率</label>
          <div style="display:flex; gap:10px; flex-wrap:wrap;">
            <input class="form-input" data-id="${escapeHtml(id)}" data-key="dilutionMin" type="number" step="any" placeholder="min" value="${p.dilution?.min ?? ""}">
            <input class="form-input" data-id="${escapeHtml(id)}" data-key="dilutionMax" type="number" step="any" placeholder="max" value="${p.dilution?.max ?? ""}">
            <input class="form-input" data-id="${escapeHtml(id)}" data-key="dilutionDefault" type="number" step="any" placeholder="default" value="${p.dilution?.default ?? ""}">
          </div>
        </div>

        <div class="edit-line">
          <label>標準使用量</label>
          <div style="display:flex; gap:10px; flex-wrap:wrap;">
            <input class="form-input" data-id="${escapeHtml(id)}" data-key="standardDosePer10a" type="number" step="any" placeholder="per10a" value="${p.standardDose?.per10a ?? ""}">
            <input class="form-input" data-id="${escapeHtml(id)}" data-key="standardDoseUnit" placeholder="unit" value="${escapeHtml(p.standardDose?.unit ?? p.unit ?? "ml")}">
          </div>
        </div>

        <div class="edit-line">
          <label>規格（1本/1袋あたり）</label>
          <div style="display:flex; gap:10px; flex-wrap:wrap;">
            <input class="form-input" data-id="${escapeHtml(id)}" data-key="packagingAmountPerPack" type="number" step="any" placeholder="量" value="${p.packaging?.amountPerPack ?? ""}">
            <input class="form-input" data-id="${escapeHtml(id)}" data-key="packagingUnit" placeholder="unit" value="${escapeHtml(p.packaging?.unit ?? p.unit ?? "ml")}">
            <input class="form-input" data-id="${escapeHtml(id)}" data-key="packagingPackLabel" placeholder="本 / 袋" value="${escapeHtml(p.packaging?.packLabel ?? "本")}">
          </div>
        </div>

        <div class="edit-line">
          <label>年間使用回数上限</label>
          <input class="form-input" data-id="${escapeHtml(id)}" data-key="maxApplicationsPerSeason" type="number" value="${p.maxApplicationsPerSeason ?? ""}">
        </div>

        <div class="edit-line">
          <label>収穫前日数</label>
          <input class="form-input" data-id="${escapeHtml(id)}" data-key="preHarvestIntervalDays" type="number" value="${p.preHarvestIntervalDays ?? ""}">
        </div>

        <div class="edit-line">
          <label>再入場制限時間</label>
          <input class="form-input" data-id="${escapeHtml(id)}" data-key="reentryIntervalHours" type="number" value="${p.reentryIntervalHours ?? ""}">
        </div>

        <div class="edit-line">
          <label>抵抗性コード</label>
          <input class="form-input" data-id="${escapeHtml(id)}" data-key="resistanceCode" value="${escapeHtml(p.resistanceCode)}">
        </div>

        <div class="edit-line">
          <label>メモ</label>
          <textarea class="form-input" data-id="${escapeHtml(id)}" data-key="notes" rows="2">${escapeHtml(p.notes)}</textarea>
        </div>

        <div class="edit-line">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
            <label style="margin:0;">成分情報（1行1レコード）</label>
            <button type="button" class="secondary-btn" data-action="add-ingredient">成分行を追加</button>
          </div>
          <div style="display:grid; gap:6px; margin-top:8px;">
            ${ingredientRows.map((row, i) => `
              <div class="ingredient-row" data-index="${i}" style="display:grid; grid-template-columns: 1.1fr 0.9fr 0.8fr 0.8fr 0.8fr 1.1fr auto; gap:6px; align-items:center;">
                <input class="form-input" data-array="ingredient" data-index="${i}" data-field="name" placeholder="成分名" value="${escapeHtml(row.name)}">
                <input class="form-input" data-array="ingredient" data-index="${i}" data-field="kind" placeholder="区分" value="${escapeHtml(row.kind)}">
                <input class="form-input" data-array="ingredient" data-index="${i}" data-field="concentrationPercent" type="number" step="any" placeholder="含有率%" value="${escapeHtml(row.concentrationPercent)}">
                <input class="form-input" data-array="ingredient" data-index="${i}" data-field="resistanceScheme" placeholder="IRAC/FRAC/HRAC" value="${escapeHtml(row.resistanceScheme)}">
                <input class="form-input" data-array="ingredient" data-index="${i}" data-field="resistanceCode" placeholder="コード" value="${escapeHtml(row.resistanceCode)}">
                <input class="form-input" data-array="ingredient" data-index="${i}" data-field="source" placeholder="備考/由来" value="${escapeHtml(row.source)}">
                <button type="button" class="secondary-btn" data-action="remove-ingredient" data-index="${i}">削除</button>
              </div>
            `).join("")}
          </div>
        </div>

        <div class="edit-line">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
            <label style="margin:0;">適用表（1行1レコード）</label>
            <button type="button" class="secondary-btn" data-action="add-application">適用行を追加</button>
          </div>
          <div style="display:grid; gap:6px; margin-top:8px;">
            ${applicationRows.map((row, i) => `
              <div class="application-row" data-index="${i}" style="display:grid; grid-template-columns: 1fr 1fr 0.9fr 1fr 1fr 0.8fr 0.8fr 0.8fr 1fr auto; gap:6px; align-items:center;">
                <input class="form-input" data-array="application" data-index="${i}" data-field="crop" placeholder="作物" value="${escapeHtml(row.crop)}">
                <input class="form-input" data-array="application" data-index="${i}" data-field="target" placeholder="対象" value="${escapeHtml(row.target)}">
                <input class="form-input" data-array="application" data-index="${i}" data-field="dilution" placeholder="希釈" value="${escapeHtml(row.dilution)}">
                <input class="form-input" data-array="application" data-index="${i}" data-field="sprayVolume" placeholder="散布液量" value="${escapeHtml(row.sprayVolume)}">
                <input class="form-input" data-array="application" data-index="${i}" data-field="timing" placeholder="使用時期" value="${escapeHtml(row.timing)}">
                <input class="form-input" data-array="application" data-index="${i}" data-field="maxProductApplications" type="number" placeholder="製品回数" value="${escapeHtml(row.maxProductApplications)}">
                <input class="form-input" data-array="application" data-index="${i}" data-field="method" placeholder="方法" value="${escapeHtml(row.method)}">
                <input class="form-input" data-array="application" data-index="${i}" data-field="maxActiveIngredientApplications" type="number" placeholder="有効成分回数" value="${escapeHtml(row.maxActiveIngredientApplications)}">
                <input class="form-input" data-array="application" data-index="${i}" data-field="note" placeholder="備考" value="${escapeHtml(row.note)}">
                <button type="button" class="secondary-btn" data-action="remove-application" data-index="${i}">削除</button>
              </div>
            `).join("")}
          </div>
        </div>

      </div>
    `);

    const card = editorEl.querySelector(".pesticide-detail-card");
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
        nextRows.push({ name: "", kind: "", concentrationPercent: "", resistanceScheme: "", resistanceCode: "", source: "" });
        current[selectedId].ingredients = nextRows;
        renderEditor();
        hasUnsavedChanges = true;
        return;
      }

      if (action === "remove-ingredient") {
        const idx = Number(btn.dataset.index);
        const nextRows = normalizeIngredientRows(current[selectedId]?.ingredients);
        if (Number.isInteger(idx) && idx >= 0 && idx < nextRows.length) {
          nextRows.splice(idx, 1);
          current[selectedId].ingredients = nextRows.length > 0 ? nextRows : [];
          renderEditor();
          hasUnsavedChanges = true;
        }
        return;
      }

      if (action === "add-application") {
        const nextRows = normalizeApplicationRows(current[selectedId]?.applications);
        nextRows.push({
          crop: "",
          target: "",
          dilution: "",
          sprayVolume: "",
          timing: "",
          maxProductApplications: "",
          method: "",
          maxActiveIngredientApplications: "",
          note: ""
        });
        current[selectedId].applications = nextRows;
        renderEditor();
        hasUnsavedChanges = true;
        return;
      }

      if (action === "remove-application") {
        const idx = Number(btn.dataset.index);
        const nextRows = normalizeApplicationRows(current[selectedId]?.applications);
        if (Number.isInteger(idx) && idx >= 0 && idx < nextRows.length) {
          nextRows.splice(idx, 1);
          current[selectedId].applications = nextRows.length > 0 ? nextRows : [];
          renderEditor();
          hasUnsavedChanges = true;
        }
      }
    });

    card?.querySelectorAll("input, textarea, select").forEach(el => {
      el.addEventListener("input", () => {
        hasUnsavedChanges = true;
      });
      el.addEventListener("change", () => {
        hasUnsavedChanges = true;
      });
    });

    hasUnsavedChanges = false;
  }

  function render() {
    refreshIdSuggestions();
    refreshTargetOptions();
    renderEditor();
  }

  render();

  function syncSelectedFromInputs() {
    if (!selectedId) return;

    const card = editorEl.querySelector(".pesticide-detail-card");
    if (!card) return;

    const id = normalizePesticideId(card.dataset.id || selectedId);
    if (!id) return;
    const getValue = key => card.querySelector(`[data-key=\"${key}\"]`)?.value ?? "";
    const prev = current[id] || buildEmptyPesticideDetail();

    const next = {
      ...buildEmptyPesticideDetail(),
      ...prev,
      name: getValue("name").trim(),
      maker: getValue("maker").trim(),
      category: getValue("category").trim(),
      unit: getValue("unit").trim() || "ml",
      registrationNo: getValue("registrationNo").trim(),
      formulation: getValue("formulation").trim(),
      price: parsePriceText(getValue("priceText"), id),
      dilution: {
        min: parseNullableNumber(getValue("dilutionMin")),
        max: parseNullableNumber(getValue("dilutionMax")),
        default: parseNullableNumber(getValue("dilutionDefault"))
      },
      standardDose: {
        per10a: parseNullableNumber(getValue("standardDosePer10a")),
        unit: getValue("standardDoseUnit").trim() || getValue("unit").trim() || "ml"
      },
      packaging: {
        amountPerPack: parseNullableNumber(getValue("packagingAmountPerPack")),
        unit: getValue("packagingUnit").trim() || getValue("unit").trim() || "ml",
        packLabel: getValue("packagingPackLabel").trim() || "本"
      },
      maxApplicationsPerSeason: parseNullableNumber(getValue("maxApplicationsPerSeason")),
      preHarvestIntervalDays: parseNullableNumber(getValue("preHarvestIntervalDays")),
      reentryIntervalHours: parseNullableNumber(getValue("reentryIntervalHours")),
      resistanceCode: getValue("resistanceCode").trim(),
      notes: getValue("notes").trim()
    };

    const ingredients = Array.from(card.querySelectorAll(".ingredient-row"))
      .map(row => {
        const getRowValue = field => row.querySelector(`[data-field="${field}"]`)?.value ?? "";
        const name = getRowValue("name").trim();
        const kind = getRowValue("kind").trim();
        const concentrationPercentRaw = getRowValue("concentrationPercent").trim();
        const resistanceScheme = getRowValue("resistanceScheme").trim().toUpperCase();
        const resistanceCode = getRowValue("resistanceCode").trim();
        const source = getRowValue("source").trim();

        if (!name && !kind && !concentrationPercentRaw && !resistanceScheme && !resistanceCode && !source) {
          return null;
        }

        const out = {
          name,
          kind
        };

        if (concentrationPercentRaw !== "") {
          out.concentrationPercent = parseOptionalNumberOrThrow(concentrationPercentRaw, "成分情報の含有率", id);
        }
        if (resistanceScheme || resistanceCode) {
          out.resistance = {
            scheme: resistanceScheme,
            code: resistanceCode
          };
        }
        if (source) {
          out.source = source;
        }
        return out;
      })
      .filter(Boolean);

    const applications = Array.from(card.querySelectorAll(".application-row"))
      .map(row => {
        const getRowValue = field => row.querySelector(`[data-field="${field}"]`)?.value ?? "";
        const crop = getRowValue("crop").trim();
        const target = getRowValue("target").trim();
        const dilution = getRowValue("dilution").trim();
        const sprayVolume = getRowValue("sprayVolume").trim();
        const timing = getRowValue("timing").trim();
        const maxProductApplicationsRaw = getRowValue("maxProductApplications").trim();
        const method = getRowValue("method").trim();
        const maxActiveIngredientApplicationsRaw = getRowValue("maxActiveIngredientApplications").trim();
        const note = getRowValue("note").trim();

        if (!crop && !target && !dilution && !sprayVolume && !timing && !maxProductApplicationsRaw && !method && !maxActiveIngredientApplicationsRaw && !note) {
          return null;
        }

        const out = {
          crop,
          target,
          dilution,
          sprayVolume,
          timing,
          method
        };

        if (maxProductApplicationsRaw !== "") {
          out.maxProductApplications = parseOptionalNumberOrThrow(maxProductApplicationsRaw, "適用表の製品使用回数", id);
        }
        if (maxActiveIngredientApplicationsRaw !== "") {
          out.maxActiveIngredientApplications = parseOptionalNumberOrThrow(maxActiveIngredientApplicationsRaw, "適用表の有効成分使用回数", id);
        }
        if (note) {
          out.note = note;
        }

        return out;
      })
      .filter(Boolean);

    next.ingredients = ingredients;
    next.applications = applications;
    current[id] = toCanonicalPesticideDetail(next);
  }

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
    const nextId = normalizePesticideId(targetEl.value || "");
    if (nextId === selectedId) return;

    if (!confirmDiscardChanges()) {
      targetEl.value = selectedId;
      return;
    }

    selectedId = nextId;
    renderEditor();
  };

  document.getElementById("add-pesticide-detail-from-candidate").onclick = () => {
    if (!confirmDiscardChanges()) {
      return;
    }

    const candidate = normalizePesticideId(candidateEl.value || "");
    if (!candidate) return;

    if (current[candidate]) {
      alert(`ID ${candidate} は既に存在します。`);
      return;
    }

    const info = PESTICIDE_PREFIXES.find(v => candidate.startsWith(v.prefix));

    current[candidate] = {
      ...buildEmptyPesticideDetail(),
      category: info?.category || "",
      unit: "ml"
    };

    selectedId = candidate;
    searchKeyword = "";
    searchEl.value = "";
    render();
  };

  document.getElementById("delete-pesticide-detail-btn").onclick = () => {
    if (!selectedId || !current[selectedId]) return;

    if (!confirmDiscardChanges()) {
      return;
    }

    const name = String(current[selectedId]?.name || "").trim();
    const ok = confirm(`ID ${selectedId}${name ? ` (${name})` : ""} を削除しますか？\nこの操作は保存時に確定されます。`);
    if (!ok) return;

    delete current[selectedId];
    selectedId = "";

    render();
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
      normalized[id] = toCanonicalPesticideDetail(current[id]);
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
}
