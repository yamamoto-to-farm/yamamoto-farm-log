// admin/edit-json/card-edit-fertilizer-detail.js
import { saveJSON } from "/common/json.js?v=2026031418";
import { showSaveModal, completeSaveModal } from "/common/save-modal.js?v=2026031418";

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

export function renderEditCard({ dataName, json, container, finalPath }) {

  // タイトル
  const title = document.getElementById("page-title");
  if (title) title.textContent = "肥料詳細情報（fertilizer-detail.json）";

  container.insertAdjacentHTML("beforeend", `
    <div id="fertilizer-list"></div>

    <button id="add-fertilizer-btn" class="primary-btn" style="margin-top:20px;">
      ＋ 肥料を追加
    </button>

    <button id="save-btn" class="primary-btn" style="margin-top:20px;">
      保存する
    </button>
  `);

  const list = document.getElementById("fertilizer-list");

  // -----------------------------
  // レンダリング
  // -----------------------------
  function render() {
    list.innerHTML = "";

    for (const id in json) {
      const f = json[id];

      list.insertAdjacentHTML("beforeend", `
        <div class="card fertilizer-detail-card" data-id="${escapeHtml(id)}" style="margin-bottom:20px;">
          <h3>${escapeHtml(id)}</h3>

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
              <input class="form-input" data-id="${escapeHtml(id)}" data-key="n" type="number" value="${f.n ?? 0}">
              <input class="form-input" data-id="${escapeHtml(id)}" data-key="p" type="number" value="${f.p ?? 0}">
              <input class="form-input" data-id="${escapeHtml(id)}" data-key="k" type="number" value="${f.k ?? 0}">
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
    }
  }

  render();

  // -----------------------------
  // 肥料追加
  // -----------------------------
  document.getElementById("add-fertilizer-btn").onclick = () => {
    const newId = "F" + String(Object.keys(json).length + 1).padStart(3, "0");
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

    showSaveModal("保存しています…");

    const cards = container.querySelectorAll(".fertilizer-detail-card");

    try {
      cards.forEach(card => {
        const id = card.dataset.id;
        const getValue = key => card.querySelector(`[data-key=\"${key}\"]`)?.value ?? "";

        json[id] = {
          ...(json[id] || {}),
          name: getValue("name").trim(),
          maker: getValue("maker").trim(),
          n: Number(getValue("n")) || 0,
          p: Number(getValue("p")) || 0,
          k: Number(getValue("k")) || 0,
          price: parsePriceText(getValue("priceText"), id),
          notes: getValue("notes").trim()
        };
      });
    } catch (e) {
      alert(e.message || "入力形式を確認してください");
      return;
    }

    const savePath = "data/" + finalPath.replace(/^\/data\//, "");
    await saveJSON(savePath, json);

    completeSaveModal("保存が完了しました");
  };
}
