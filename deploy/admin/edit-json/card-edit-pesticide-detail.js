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
    activeIngredients: [],
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
    maxApplicationsPerSeason: null,
    preHarvestIntervalDays: null,
    reentryIntervalHours: null,
    resistanceCode: "",
    notes: ""
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

function listToText(value) {
  return Array.isArray(value) ? value.join("\n") : "";
}

function parseListText(raw) {
  return String(raw || "")
    .split(/[\n,]/)
    .map(v => v.trim())
    .filter(Boolean);
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

    if (!/^[A-Z]{2}\d{4}$/.test(id)) {
      errors.push(`ID ${id}: ID は CCNNNN 形式で入力してください（例: FG0001）。`);
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
  });

  return errors;
}

export function renderEditCard({ dataName, json, container, finalPath }) {
  const title = document.getElementById("page-title");
  if (title) title.textContent = "農薬詳細情報（pesticide-detail.json）";

  const current = (json && typeof json === "object" && !Array.isArray(json)) ? json : {};
  let selectedCategory = "";

  container.insertAdjacentHTML("beforeend", `
    <div class="card" style="margin-bottom:12px;">
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button class="secondary-btn" type="button" onclick="location.href='?data=pesticide-index'">農薬基本情報へ</button>
      </div>
    </div>

    <div class="card" style="margin-bottom:12px;">
      <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:end;">
        <div>
          <label class="form-label">カテゴリフィルタ</label>
          <select id="pesticide-detail-category-filter" class="form-input" style="min-width:220px;"></select>
        </div>
        <div>
          <label class="form-label">ID候補（未使用）</label>
          <select id="pesticide-detail-id-candidate" class="form-input" style="min-width:240px;"></select>
        </div>
        <button id="add-pesticide-detail-from-candidate" class="secondary-btn" type="button">候補IDで追加</button>
      </div>
      <div id="pesticide-detail-visible-count" style="margin-top:8px; color:#555;"></div>
    </div>

    <div id="pesticide-detail-list"></div>

    <button id="sort-pesticide-detail-btn" class="secondary-btn" style="margin-top:12px;">
      ID順に並び替え
    </button>

    <button id="add-pesticide-btn" class="primary-btn" style="margin-top:20px;">
      ＋ 農薬を追加
    </button>

    <button id="save-btn" class="primary-btn" style="margin-top:20px;">
      保存する
    </button>
  `);

  const list = document.getElementById("pesticide-detail-list");
  const filterEl = document.getElementById("pesticide-detail-category-filter");
  const candidateEl = document.getElementById("pesticide-detail-id-candidate");
  const countEl = document.getElementById("pesticide-detail-visible-count");

  function getVisibleIds() {
    return Object.keys(current)
      .map(v => normalizePesticideId(v))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, "ja", { numeric: true, sensitivity: "base" }))
      .filter(id => {
        if (!selectedCategory) return true;
        return String(current[id]?.category || "").trim() === selectedCategory;
      });
  }

  function refreshFilterOptions() {
    const catSet = new Set(PESTICIDE_CATEGORIES);
    Object.keys(current).forEach(id => {
      const cat = String(current[id]?.category || "").trim();
      if (cat) catSet.add(cat);
    });

    const options = ["", ...Array.from(catSet)];
    filterEl.innerHTML = options
      .map(v => `<option value="${escapeHtml(v)}">${v ? escapeHtml(v) : "全カテゴリ"}</option>`)
      .join("");
    filterEl.value = selectedCategory;
  }

  function refreshIdSuggestions() {
    const suggestions = buildPesticideIdSuggestions(Object.keys(current), 8);
    candidateEl.innerHTML = suggestions
      .map(v => `<option value="${v.id}">${escapeHtml(v.label)}</option>`)
      .join("");
  }

  function render() {
    list.innerHTML = "";
    refreshFilterOptions();
    refreshIdSuggestions();

    const ids = getVisibleIds();
    if (countEl) {
      countEl.textContent = `表示中 ${ids.length} 件 / 全体 ${Object.keys(current).length} 件`;
    }

    for (const id of ids) {
      const p = { ...buildEmptyPesticideDetail(), ...(current[id] || {}) };

      list.insertAdjacentHTML("beforeend", `
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
            <label>有効成分（改行 or カンマ区切り）</label>
            <textarea class="form-input" data-id="${escapeHtml(id)}" data-key="activeIngredientsText" rows="3">${escapeHtml(listToText(p.activeIngredients))}</textarea>
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
            <label>対象作物（改行 or カンマ区切り）</label>
            <textarea class="form-input" data-id="${escapeHtml(id)}" data-key="targetCropsText" rows="3">${escapeHtml(listToText(p.targetCrops))}</textarea>
          </div>

          <div class="edit-line">
            <label>対象病害虫/雑草（改行 or カンマ区切り）</label>
            <textarea class="form-input" data-id="${escapeHtml(id)}" data-key="targetPestsText" rows="3">${escapeHtml(listToText(p.targetPests))}</textarea>
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
        </div>
      `);
    }
  }

  render();

  function syncVisibleFromInputs() {
    const cards = container.querySelectorAll(".pesticide-detail-card");

    cards.forEach(card => {
      const id = normalizePesticideId(card.dataset.id || "");
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
        activeIngredients: parseListText(getValue("activeIngredientsText")),
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
        targetCrops: parseListText(getValue("targetCropsText")),
        targetPests: parseListText(getValue("targetPestsText")),
        maxApplicationsPerSeason: parseNullableNumber(getValue("maxApplicationsPerSeason")),
        preHarvestIntervalDays: parseNullableNumber(getValue("preHarvestIntervalDays")),
        reentryIntervalHours: parseNullableNumber(getValue("reentryIntervalHours")),
        resistanceCode: getValue("resistanceCode").trim(),
        notes: getValue("notes").trim()
      };

      current[id] = next;
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

  document.getElementById("add-pesticide-detail-from-candidate").onclick = () => {
    try {
      syncVisibleFromInputs();
    } catch (e) {
      alert(e.message || "入力形式を確認してください");
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
      category: selectedCategory || info?.category || "",
      unit: "ml"
    };

    render();
  };

  document.getElementById("sort-pesticide-detail-btn").onclick = () => {
    try {
      syncVisibleFromInputs();
    } catch (e) {
      alert(e.message || "入力形式を確認してください");
      return;
    }

    const sorted = {};
    Object.keys(current)
      .sort((a, b) => a.localeCompare(b, "ja", { numeric: true, sensitivity: "base" }))
      .forEach(id => {
        sorted[id] = current[id];
      });

    Object.keys(current).forEach(k => {
      delete current[k];
    });
    Object.assign(current, sorted);

    render();
  };

  document.getElementById("add-pesticide-btn").onclick = () => {
    try {
      syncVisibleFromInputs();
    } catch (e) {
      alert(e.message || "入力形式を確認してください");
      return;
    }

    const suggestion = buildPesticideIdSuggestions(Object.keys(current), 1)[0];
    const newId = suggestion?.id || "FG0001";
    const info = PESTICIDE_PREFIXES.find(v => newId.startsWith(v.prefix));

    current[newId] = {
      ...buildEmptyPesticideDetail(),
      category: selectedCategory || info?.category || ""
    };

    render();
  };

  document.getElementById("save-btn").onclick = async () => {
    try {
      syncVisibleFromInputs();
    } catch (e) {
      alert(e.message || "入力形式を確認してください");
      return;
    }

    const errors = validateBeforeSave(current);
    if (errors.length > 0) {
      alert(`保存できません。\n${errors.join("\n")}`);
      return;
    }

    showSaveModal("保存しています…");

    const savePath = "data/" + finalPath.replace(/^\/data\//, "");
    await saveJSON(savePath, current);
    completeSaveModal("保存が完了しました");
  };
}
