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

function asJsonText(value) {
  return JSON.stringify(value ?? {}, null, 2);
}

export function renderEditCard({ dataName, json, container, finalPath }) {
  const title = document.getElementById("page-title");
  if (title) title.textContent = "農薬詳細情報（pesticide-detail.json）";

  const current = (json && typeof json === "object" && !Array.isArray(json)) ? json : {};

  container.insertAdjacentHTML("beforeend", `
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
        <div class="card" style="margin-bottom:20px;">
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
            <textarea class="form-input" data-id="${escapeHtml(id)}" data-key="price" rows="4">${escapeHtml(asJsonText(p.price))}</textarea>
          </div>

          <div class="edit-line">
            <label>有効成分配列（JSON）</label>
            <textarea class="form-input" data-id="${escapeHtml(id)}" data-key="activeIngredients" rows="4">${escapeHtml(asJsonText(p.activeIngredients))}</textarea>
          </div>

          <div class="edit-line">
            <label>希釈倍率（JSON）</label>
            <textarea class="form-input" data-id="${escapeHtml(id)}" data-key="dilution" rows="4">${escapeHtml(asJsonText(p.dilution))}</textarea>
          </div>

          <div class="edit-line">
            <label>標準使用量（JSON）</label>
            <textarea class="form-input" data-id="${escapeHtml(id)}" data-key="standardDose" rows="4">${escapeHtml(asJsonText(p.standardDose))}</textarea>
          </div>

          <div class="edit-line">
            <label>対象作物（JSON 配列）</label>
            <textarea class="form-input" data-id="${escapeHtml(id)}" data-key="targetCrops" rows="3">${escapeHtml(asJsonText(p.targetCrops))}</textarea>
          </div>

          <div class="edit-line">
            <label>対象病害虫/雑草（JSON 配列）</label>
            <textarea class="form-input" data-id="${escapeHtml(id)}" data-key="targetPests" rows="3">${escapeHtml(asJsonText(p.targetPests))}</textarea>
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

    const inputs = container.querySelectorAll("[data-id]");
    let parseError = false;

    inputs.forEach(el => {
      if (parseError) return;

      const id = el.dataset.id;
      const key = el.dataset.key;
      let value = el.value;

      if (!current[id]) current[id] = buildEmptyPesticideDetail();

      if (["price", "activeIngredients", "dilution", "standardDose", "targetCrops", "targetPests"].includes(key)) {
        try {
          value = JSON.parse(value || (key === "price" || key === "dilution" || key === "standardDose" ? "{}" : "[]"));
        } catch {
          alert(`${id} の ${key} は JSON 形式で入力してください`);
          parseError = true;
          return;
        }
      }

      if (["maxApplicationsPerSeason", "preHarvestIntervalDays", "reentryIntervalHours"].includes(key)) {
        value = value === "" ? null : Number(value);
      }

      current[id][key] = value;
    });

    if (parseError) return;

    const savePath = "data/" + finalPath.replace(/^\/data\//, "");
    await saveJSON(savePath, current);
    completeSaveModal("保存が完了しました");
  };
}
