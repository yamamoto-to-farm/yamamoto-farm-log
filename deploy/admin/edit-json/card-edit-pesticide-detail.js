// admin/edit-json/card-edit-pesticide-detail.js
import { saveJSON } from "/common/json.js?v=1";
import { showSaveModal, completeSaveModal } from "/common/save-modal.js?v=1";

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
  return Number.isNaN(n) ? null : n;
}

export function renderEditCard({ dataName, json, container, finalPath }) {
  const title = document.getElementById("page-title");
  if (title) title.textContent = "農薬詳細情報（pesticide-detail.json）";

  const current = (json && typeof json === "object" && !Array.isArray(json)) ? json : {};

  container.insertAdjacentHTML("beforeend", `
    <div class="card" style="margin-bottom:12px;">
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button class="secondary-btn" type="button" onclick="location.href='?data=pesticide-index'">農薬基本情報へ</button>
      </div>
    </div>

    <div id="pesticide-detail-list"></div>

    <button id="add-pesticide-btn" class="primary-btn" style="margin-top:20px;">
      ＋ 農薬を追加
    </button>

    <button id="save-btn" class="primary-btn" style="margin-top:20px;">
      保存する
    </button>
  `);

  const list = document.getElementById("pesticide-detail-list");

  function render() {
    list.innerHTML = "";

    for (const id of Object.keys(current)) {
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

  document.getElementById("add-pesticide-btn").onclick = () => {
    const ids = Object.keys(current);
    let maxNo = 0;
    ids.forEach(id => {
      const m = /^F(\d+)$/.exec(id);
      if (m) maxNo = Math.max(maxNo, Number(m[1]));
    });
    const newId = `F${String(maxNo + 1).padStart(3, "0")}`;
    current[newId] = buildEmptyPesticideDetail();
    render();
  };

  document.getElementById("save-btn").onclick = async () => {
    showSaveModal("保存しています…");

    const cards = container.querySelectorAll(".pesticide-detail-card");

    try {
      cards.forEach(card => {
        const id = card.dataset.id;
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
    } catch (e) {
      alert(e.message || "入力形式を確認してください");
      return;
    }

    const savePath = "data/" + finalPath.replace(/^\/data\//, "");
    await saveJSON(savePath, current);
    completeSaveModal("保存が完了しました");
  };
}
