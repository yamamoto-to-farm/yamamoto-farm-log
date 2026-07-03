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
    memo: ""
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
      ...prev
    };
  });

  await saveJSON("data/variety-detail.json", nextDetail);
}

export function renderEditCard({ json, container, finalPath }) {
  const title = document.getElementById("page-title");
  if (title) title.textContent = "品種基本情報（varieties.json）";

  let listData = Array.isArray(json)
    ? json.map(v => ({ ...v }))
    : Object.values(json || {}).map(v => ({ ...v }));

  container.insertAdjacentHTML("beforeend", `
    <div class="card">
      <h2>品種一覧</h2>
      <p style="margin:0 0 12px; color:#555;">
        品種名の追加・削除を保存すると、variety-detail.json も同じ品種名で同期されます。
      </p>

      <div id="variety-list"></div>

      <button id="sort-variety-btn" class="secondary-btn" style="margin-top:12px;">
        名前順に並び替え
      </button>

      <button id="add-variety-btn" class="primary-btn" style="margin-top:20px;">
        ＋ 品種を追加
      </button>

      <button id="save-btn" class="primary-btn" style="margin-top:20px;">
        保存する
      </button>
    </div>
  `);

  const listEl = document.getElementById("variety-list");

  function render() {
    listEl.innerHTML = "";

    listData.forEach((item, index) => {
      const name = item.name ?? "";
      const type = item.type ?? "";
      const harvestMonth = item.harvestMonth ?? "";

      listEl.insertAdjacentHTML("beforeend", `
        <div class="sub-card" style="margin-bottom:12px;">
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
            <input class="form-input variety-harvest-month" data-index="${index}" value="${escapeHtml(harvestMonth)}" inputmode="numeric">
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
        const idx = Number(btn.dataset.index);
        if (!confirm("この品種を削除しますか？\n保存時に variety-detail からも削除されます。")) return;
        listData.splice(idx, 1);
        render();
      };
    });

    document.querySelectorAll(".jump-variety-detail-btn").forEach(btn => {
      btn.onclick = () => {
        const idx = Number(btn.dataset.index);
        const row = btn.closest(".sub-card");
        const nameInput = row?.querySelector(".variety-name");
        const name = nameInput?.value.trim() || "";

        if (!name) {
          alert("先に品種名を入力してください。");
          return;
        }

        location.href = `?data=variety-detail&variety=${encodeURIComponent(name)}`;
      };
    });
  }

  function buildRowsFromInputs() {
    const names = container.querySelectorAll(".variety-name");
    const types = container.querySelectorAll(".variety-type");
    const harvestMonths = container.querySelectorAll(".variety-harvest-month");

    const rows = [];
    const usedNames = new Set();

    for (let i = 0; i < names.length; i += 1) {
      const name = names[i].value.trim();
      const type = types[i].value.trim();
      const harvestMonthRaw = harvestMonths[i].value.trim();

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

      rows.push({
        name,
        type,
        harvestMonth
      });
    }

    return rows;
  }

  render();

  document.getElementById("sort-variety-btn").onclick = () => {
    const rows = buildRowsFromInputs();
    if (!rows) return;

    listData = rows.sort((a, b) =>
      String(a.name || "").localeCompare(String(b.name || ""), "ja", { sensitivity: "base" })
    );

    render();
  };

  document.getElementById("add-variety-btn").onclick = () => {
    const rows = buildRowsFromInputs();
    if (!rows) return;

    listData = rows;
    listData.push({
      name: "",
      type: "",
      harvestMonth: null
    });

    render();
  };

  document.getElementById("save-btn").onclick = async () => {
    const newList = buildRowsFromInputs();
    if (!newList) return;

    showSaveModal("保存しています…");

    const savePath = "data/" + finalPath.replace(/^\/data\//, "");
    await saveJSON(savePath, newList);
    await syncVarietyDetailByVarieties(newList);

    completeSaveModal("保存が完了しました");
  };
}
