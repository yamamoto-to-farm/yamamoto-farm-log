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
    memo: "",
    gdd: {
      mode: "effective",
      dapRange: null,
      expectedCropType: null,
      seasonCorrection: {
        lowSun: null,
        lowTemp: null
      }
    }
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
      ...prev,
      gdd: {
        ...template.gdd,
        ...(prev.gdd || {})
      }
    };
  });

  await saveJSON("data/variety-detail.json", nextDetail);

  let currentTargets = {};
  try {
    currentTargets = await loadJSON("/data/gdd-targets.json");
  } catch {
    currentTargets = {};
  }

  const nextTargets = {};
  varietyList.forEach(item => {
    const name = String(item.name || "").trim();
    if (!name) return;
    const previous = currentTargets[name];
    nextTargets[name] = previous && typeof previous === "object"
      ? previous
      : { mode: "effective", targets: {} };
  });
  await saveJSON("data/gdd-targets.json", nextTargets);
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
        品種名の追加・削除を保存すると、variety-detail.json と gdd-targets.json も同じ品種名で同期されます。
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
      const params = new URLSearchParams(location.search);
      const initialVariety = String(params.get("variety") || "").trim();
          </div>

          <div class="form-row">
            <label class="form-label">種別</label>
            <input class="form-input variety-type" data-index="${index}" value="${escapeHtml(type)}" placeholder="寒玉キャベツなど">
          </div>

          <div class="form-row">
            <label class="form-label">収穫月（1-12）</label>
            <input class="form-input variety-harvest-month" data-index="${index}" value="${escapeHtml(harvestMonth)}" inputmode="numeric">
          <div class="sub-card" style="margin-bottom:14px; background:#f8fbff; border:1px solid #dbeafe;">
            <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:end;">
              <div>
                <label class="form-label">品種検索（部分一致）</label>
                <input id="variety-name-search" class="form-input" style="min-width:220px;" placeholder="品種名・種別で検索">
              </div>
              <div>
                <label class="form-label">編集対象を選択</label>
                <button id="open-variety-target-modal" class="secondary-btn" type="button" style="min-width:320px; text-align:left;">
                  品種を選択
                </button>
                <div id="variety-target-current" style="margin-top:6px; color:#555;"></div>
              </div>
              <button id="add-variety-btn" class="secondary-btn" type="button">＋ 品種を追加</button>
            </div>
            <div id="variety-visible-count" style="margin-top:8px; color:#555;"></div>
          </div>

      `);
    });

    document.querySelectorAll(".delete-variety-btn").forEach(btn => {
      btn.onclick = () => {
        const idx = Number(btn.dataset.index);
        if (!confirm("この品種を削除しますか？\n保存時に variety-detail からも削除されます。")) return;
        listData.splice(idx, 1);
        const visibleRows = getVisibleRows();
        if (visibleRows.length === 0) {
          listEl.innerHTML = `
            <div class="sub-card" style="margin-bottom:12px; color:#666;">
              表示対象がありません。種別・品種検索・編集対象の選択条件を見直してください。
            </div>
          `;
          return;
        }

        visibleRows.forEach(({ item, index }) => {
      };
    });

    document.querySelectorAll(".jump-variety-detail-btn").forEach(btn => {
      btn.onclick = () => {
            <div class="sub-card" data-index="${index}" style="margin-bottom:12px;">
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
                <input class="form-input variety-harvest-month" data-index="${index}" value="${escapeHtml(harvestMonth)}" inputmode="numeric" step="1" min="1" max="12">

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


      nameSearchEl.oninput = () => {
        syncVisibleRowToListData();
        nameKeyword = nameSearchEl.value || "";
        selectedVarietyIndex = -1;
        render();
      };

      if (openTargetModalBtn) {
        openTargetModalBtn.onclick = openTargetSelectModal;
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
