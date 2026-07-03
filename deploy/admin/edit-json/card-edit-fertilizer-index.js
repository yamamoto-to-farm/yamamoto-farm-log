// admin/edit-json/card-edit-fertilizer-index.js
import { loadJSON, saveJSON } from "/common/json.js?v=1";
import { showSaveModal, completeSaveModal } from "/common/save-modal.js?v=1";

function createEmptyFertilizerDetail(name = "") {
  return {
    name,
    maker: "",
    price: {},
    n: 0,
    p: 0,
    k: 0,
    notes: ""
  };
}

function toDetailPath(indexSavePath) {
  return indexSavePath.replace(/-index\.json$/, "-detail.json");
}

async function syncFertilizerDetail(indexSavePath, indexList) {
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
      ...createEmptyFertilizerDetail(item.name || ""),
      ...prev,
      name: item.name || prev.name || ""
    };
  });

  await saveJSON(detailSavePath, nextDetail);
}

export function renderEditCard({ dataName, json, container, finalPath }) {

  const title = document.getElementById("page-title");
  if (title) title.textContent = "肥料基本情報（fertilizer-index.json）";

  // json がオブジェクトの場合は配列に変換（保険）
  let listData = Array.isArray(json)
    ? json
    : Object.values(json || {});

  container.insertAdjacentHTML("beforeend", `
    <div class="card">
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px;">
        <button class="secondary-btn" type="button" onclick="location.href='?data=fertilizer-detail'">肥料詳細情報へ</button>
      </div>
      <h2>肥料一覧</h2>
      <div id="fertilizer-list"></div>

      <button id="sort-fertilizer-btn" class="secondary-btn" style="margin-top:12px;">
        ID順に並び替え
      </button>

      <button id="add-fertilizer-btn" class="primary-btn" style="margin-top:20px;">
        ＋ 肥料を追加
      </button>

      <button id="save-btn" class="primary-btn" style="margin-top:20px;">
        保存する
      </button>
    </div>
  `);

  const listEl = document.getElementById("fertilizer-list");

  // -----------------------------
  // レンダリング
  // -----------------------------
  function render() {
    listEl.innerHTML = "";

    listData.forEach((item, index) => {
      const id = item.id ?? "";
      const category = item.category ?? "";
      const name = item.name ?? "";
      const capacity = item.capacity ?? "";

      listEl.insertAdjacentHTML("beforeend", `
        <div class="sub-card" style="margin-bottom:12px;">
          <div class="form-row">
            <label class="form-label">ID</label>
            <input class="form-input fert-id" data-index="${index}" value="${id}">
          </div>

          <div class="form-row">
            <label class="form-label">カテゴリ</label>
            <input class="form-input fert-category" data-index="${index}" value="${category}">
          </div>

          <div class="form-row">
            <label class="form-label">名称</label>
            <input class="form-input fert-name" data-index="${index}" value="${name}">
          </div>

          <div class="form-row">
            <label class="form-label">容量（kgなど）</label>
            <input class="form-input fert-capacity" data-index="${index}" value="${capacity}">
          </div>

          <button class="secondary-btn delete-fert-btn" data-index="${index}" style="margin-top:8px;">
            削除
          </button>
        </div>
      `);
    });

    // 削除ボタン
    document.querySelectorAll(".delete-fert-btn").forEach(btn => {
      btn.onclick = () => {
        const idx = Number(btn.dataset.index);
        if (!confirm("この肥料を削除しますか？")) return;
        listData.splice(idx, 1);
        render();
      };
    });
  }

  render();

  function syncListDataFromInputs() {
    const ids = container.querySelectorAll(".fert-id");
    const categories = container.querySelectorAll(".fert-category");
    const names = container.querySelectorAll(".fert-name");
    const capacities = container.querySelectorAll(".fert-capacity");

    const nextList = [];

    ids.forEach((input, i) => {
      const id = input.value.trim();
      const category = categories[i].value.trim();
      const name = names[i].value.trim();
      const capacityRaw = capacities[i].value.trim();

      if (!id && !name) return;

      const capacity = capacityRaw === "" ? null : Number(capacityRaw);

      nextList.push({
        id,
        category,
        name,
        capacity
      });
    });

    listData = nextList;
  }

  document.getElementById("sort-fertilizer-btn").onclick = () => {
    syncListDataFromInputs();

    listData.sort((a, b) =>
      String(a.id || "").localeCompare(String(b.id || ""), "ja", { numeric: true, sensitivity: "base" })
    );

    render();
  };

  // -----------------------------
  // 肥料追加
  // -----------------------------
  document.getElementById("add-fertilizer-btn").onclick = () => {
    listData.push({
      id: "",
      category: "",
      name: "",
      capacity: ""
    });
    render();
  };

  // -----------------------------
  // 保存処理
  // -----------------------------
  document.getElementById("save-btn").onclick = async () => {

    showSaveModal("保存しています…");

    syncListDataFromInputs();

    const newList = listData;

    // 保存用パス生成
    const savePath = "data/" + finalPath.replace(/^\/data\//, "");

    await saveJSON(savePath, newList);
    await syncFertilizerDetail(savePath, newList);

    completeSaveModal("保存が完了しました");
  };
}
