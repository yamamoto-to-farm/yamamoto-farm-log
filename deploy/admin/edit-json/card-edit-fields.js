// admin/edit-json/card-edit-fields.js
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

function parseAddressInput(raw) {
  return String(raw || "")
    .split(/[\n,/]/)
    .map(s => s.trim())
    .filter(Boolean);
}

function createDefaultFieldDetail(templateField = {}) {
  return {
    size: "未入力（a）",
    thumbnail: "未設定",
    memo: "未入力",
    parcels: [
      {
        address: "未入力",
        officialArea: "未入力（㎡）",
        owner: "未入力",
        rightType: "未入力",
        rent: "未入力"
      }
    ],
    contracts: [
      {
        start: "未入力",
        end: "未入力",
        rent: "未入力",
        notes: "未入力"
      }
    ],
    ...templateField
  };
}

async function syncFieldDetailByFields(fieldsList) {
  let currentDetail = {};
  try {
    currentDetail = await loadJSON("/data/field-detail.json");
  } catch {
    currentDetail = {};
  }

  const templateField = createDefaultFieldDetail(currentDetail.TEMPLATE_FIELD || {});
  const nextDetail = { TEMPLATE_FIELD: templateField };

  fieldsList.forEach(field => {
    const name = (field.name || "").trim();
    if (!name) return;

    nextDetail[name] = currentDetail[name]
      ? { ...templateField, ...currentDetail[name] }
      : { ...templateField };
  });

  await saveJSON("data/field-detail.json", nextDetail);
}

export function renderEditCard({ json, container, finalPath }) {
  const title = document.getElementById("page-title");
  if (title) title.textContent = "圃場基本情報（fields.json）";

  const params = new URLSearchParams(location.search);
  const initialField = String(params.get("field") || "").trim();

  let listData = Array.isArray(json)
    ? json.map(v => ({ ...v }))
    : Object.values(json || {}).map(v => ({ ...v }));

  let selectedArea = "";
  let nameKeyword = "";
  let selectedFieldIndex = -1;

  container.insertAdjacentHTML("beforeend", `
    <div class="card">
      <h2>圃場一覧</h2>
      <p style="margin:0 0 12px; color:#555;">
        圃場名を追加・削除して保存すると、field-detail.json も同じ圃場名で自動同期されます。
      </p>

      <div class="sub-card" style="margin-bottom:14px; background:#f8fbff; border:1px solid #dbeafe;">
        <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:end;">
          <div>
            <label class="form-label">エリアフィルタ</label>
            <select id="field-area-filter" class="form-input" style="min-width:220px;"></select>
          </div>
          <div>
            <label class="form-label">圃場検索（部分一致）</label>
            <input id="field-name-search" class="form-input" style="min-width:220px;" placeholder="圃場名で検索">
          </div>
          <div>
            <label class="form-label">編集対象を選択</label>
            <select id="field-target-select" class="form-input" style="min-width:320px;"></select>
          </div>
          <button id="add-field-btn" class="secondary-btn" type="button">＋ 圃場を追加</button>
        </div>
        <div id="field-visible-count" style="margin-top:8px; color:#555;"></div>
      </div>

      <div id="field-list"></div>

      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:20px;">
        <button id="go-field-detail-btn" class="secondary-btn" type="button">圃場詳細情報へ</button>
        <button id="save-btn" class="primary-btn">保存する</button>
      </div>
    </div>
  `);

  const listEl = document.getElementById("field-list");
  const areaFilterEl = document.getElementById("field-area-filter");
  const nameSearchEl = document.getElementById("field-name-search");
  const targetSelectEl = document.getElementById("field-target-select");
  const countEl = document.getElementById("field-visible-count");
  const goDetailBtn = document.getElementById("go-field-detail-btn");

  function normalizeRows() {
    listData = listData.map(v => ({
      name: String(v.name || "").trim(),
      area: String(v.area || "").trim(),
      address: Array.isArray(v.address) ? v.address : parseAddressInput(v.address || ""),
      lat: v.lat == null || v.lat === "" ? "" : String(v.lat),
      lng: v.lng == null || v.lng === "" ? "" : String(v.lng)
    }));
  }

  function syncVisibleRowToListData() {
    const card = listEl.querySelector(".sub-card");
    if (!card) return;

    const idx = Number(card.dataset.index);
    if (!Number.isInteger(idx) || !listData[idx]) return;

    const name = String(card.querySelector(".field-name")?.value || "").trim();
    const area = String(card.querySelector(".field-area")?.value || "").trim();
    const address = parseAddressInput(card.querySelector(".field-address")?.value || "");
    const latRaw = String(card.querySelector(".field-lat")?.value || "").trim();
    const lngRaw = String(card.querySelector(".field-lng")?.value || "").trim();

    listData[idx] = {
      ...listData[idx],
      name,
      area,
      address,
      lat: latRaw,
      lng: lngRaw
    };
  }

  function getAreaRows() {
    return listData
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => {
        if (!selectedArea) return true;
        return String(item.area || "").trim() === selectedArea;
      });
  }

  function getNameFilteredRows() {
    const q = String(nameKeyword || "").trim().toLowerCase();
    if (!q) return getAreaRows();

    return getAreaRows().filter(({ item }) => {
      const name = String(item.name || "").toLowerCase();
      const area = String(item.area || "").toLowerCase();
      return name.includes(q) || area.includes(q);
    });
  }

  function getVisibleRows() {
    const rows = getNameFilteredRows();
    if (!Number.isInteger(selectedFieldIndex) || selectedFieldIndex < 0) return rows.slice(0, 1);
    const selected = rows.find(v => v.index === selectedFieldIndex);
    return selected ? [selected] : rows.slice(0, 1);
  }

  function refreshAreaOptions() {
    const areaSet = new Set();
    listData.forEach(v => {
      const area = String(v.area || "").trim();
      if (area) areaSet.add(area);
    });

    const options = ["", ...Array.from(areaSet).sort((a, b) => a.localeCompare(b, "ja"))];
    areaFilterEl.innerHTML = options
      .map(v => `<option value="${escapeHtml(v)}">${v ? escapeHtml(v) : "全エリア"}</option>`)
      .join("");
    areaFilterEl.value = selectedArea;
  }

  function refreshTargetSelectOptions() {
    const rows = getNameFilteredRows()
      .sort((a, b) => {
        const areaCmp = String(a.item.area || "").localeCompare(String(b.item.area || ""), "ja");
        if (areaCmp !== 0) return areaCmp;
        return String(a.item.name || "").localeCompare(String(b.item.name || ""), "ja");
      });

    targetSelectEl.innerHTML = rows
      .map(({ item, index }) => {
        const area = String(item.area || "").trim();
        const name = String(item.name || "").trim();
        const label = `${area || "(エリア未入力)"} / ${name || "(圃場名未入力)"}`;
        return `<option value="${index}">${escapeHtml(label)}</option>`;
      })
      .join("");

    const indices = rows.map(v => v.index);
    if (!Number.isInteger(selectedFieldIndex) || !indices.includes(selectedFieldIndex)) {
      if (initialField) {
        const hit = rows.find(v => String(v.item.name || "").trim() === initialField);
        selectedFieldIndex = hit ? hit.index : (indices[0] ?? -1);
      } else {
        selectedFieldIndex = indices[0] ?? -1;
      }
    }

    if (Number.isInteger(selectedFieldIndex) && selectedFieldIndex >= 0) {
      targetSelectEl.value = String(selectedFieldIndex);
    }
  }

  function render() {
    normalizeRows();
    refreshAreaOptions();
    refreshTargetSelectOptions();

    const searchableRows = getNameFilteredRows();
    const visibleRows = getVisibleRows();

    if (countEl) {
      countEl.textContent = `検索対象 ${searchableRows.length} 件 / 全体 ${listData.length} 件`;
    }

    if (goDetailBtn) {
      goDetailBtn.onclick = () => {
        if (!Number.isInteger(selectedFieldIndex) || selectedFieldIndex < 0 || !listData[selectedFieldIndex]) {
          alert("編集対象の圃場を選択してください。");
          return;
        }
        const name = String(listData[selectedFieldIndex].name || "").trim();
        if (!name) {
          alert("先に圃場名を入力してください。");
          return;
        }
        location.href = `?data=field-detail&field=${encodeURIComponent(name)}`;
      };
    }

    listEl.innerHTML = "";

    if (visibleRows.length === 0) {
      listEl.innerHTML = `
        <div class="sub-card" style="margin-bottom:12px; color:#666;">
          表示対象がありません。エリア・名称検索・編集対象の選択条件を見直してください。
        </div>
      `;
      return;
    }

    visibleRows.forEach(({ item, index }) => {
      const name = item.name ?? "";
      const area = item.area ?? "";
      const address = Array.isArray(item.address)
        ? item.address.join(" / ")
        : "";
      const lat = item.lat ?? "";
      const lng = item.lng ?? "";

      listEl.insertAdjacentHTML("beforeend", `
        <div class="sub-card" style="margin-bottom:12px;">
          <div class="form-row">
            <label class="form-label">圃場名</label>
            <input class="form-input field-name" data-index="${index}" value="${escapeHtml(name)}">
          </div>

          <div class="form-row">
            <label class="form-label">エリア</label>
            <input class="form-input field-area" data-index="${index}" value="${escapeHtml(area)}">
          </div>

          <div class="form-row">
            <label class="form-label">住所（/ または , 区切り）</label>
            <input class="form-input field-address" data-index="${index}" value="${escapeHtml(address)}">
          </div>

          <div class="form-row">
            <label class="form-label">緯度（lat）</label>
            <input class="form-input field-lat" data-index="${index}" value="${escapeHtml(lat)}">
          </div>

          <div class="form-row">
            <label class="form-label">経度（lng）</label>
            <input class="form-input field-lng" data-index="${index}" value="${escapeHtml(lng)}">
          </div>

          <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:8px;">
            <button class="secondary-btn delete-field-btn" data-index="${index}">
              削除
            </button>
          </div>
        </div>
      `);
    });

    document.querySelectorAll(".delete-field-btn").forEach(btn => {
      btn.onclick = () => {
        syncVisibleRowToListData();
        const idx = Number(btn.dataset.index);
        if (!confirm("この圃場を削除しますか？\n保存時に field-detail からも削除されます。")) return;
        listData.splice(idx, 1);
        if (Number.isInteger(selectedFieldIndex) && selectedFieldIndex === idx) {
          selectedFieldIndex = -1;
        } else if (Number.isInteger(selectedFieldIndex) && selectedFieldIndex > idx) {
          selectedFieldIndex -= 1;
        }
        render();
      };
    });
  }

  render();

  areaFilterEl.onchange = () => {
    syncVisibleRowToListData();
    selectedArea = areaFilterEl.value || "";
    selectedFieldIndex = -1;
    render();
  };

  nameSearchEl.oninput = () => {
    syncVisibleRowToListData();
    nameKeyword = nameSearchEl.value || "";
    selectedFieldIndex = -1;
    render();
  };

  targetSelectEl.onchange = () => {
    syncVisibleRowToListData();
    selectedFieldIndex = Number(targetSelectEl.value);
    render();
  };

  document.getElementById("add-field-btn").onclick = () => {
    syncVisibleRowToListData();
    listData.push({
      name: "",
      area: selectedArea || "",
      address: [],
      lat: "",
      lng: ""
    });
    selectedFieldIndex = listData.length - 1;
    render();
  };

  document.getElementById("save-btn").onclick = async () => {
    syncVisibleRowToListData();

    const newList = [];
    const usedNames = new Set();
    let validationError = "";

    for (const row of listData) {
      const name = String(row.name || "").trim();
      const area = String(row.area || "").trim();
      const address = Array.isArray(row.address) ? row.address : parseAddressInput(row.address || "");
      const latRaw = String(row.lat || "").trim();
      const lngRaw = String(row.lng || "").trim();

      if (!name && !area) {
        continue;
      }

      if (!name) {
        validationError = "圃場名が空の行があります。圃場名を入力してください。";
        break;
      }

      if (usedNames.has(name)) {
        validationError = `圃場名「${name}」が重複しています。`;
        break;
      }
      usedNames.add(name);

      const lat = latRaw === "" ? null : Number(latRaw);
      const lng = lngRaw === "" ? null : Number(lngRaw);

      newList.push({
        name,
        area,
        address,
        lat,
        lng
      });
    }

    if (validationError) {
      alert(validationError);
      return;
    }

    showSaveModal("保存しています…");

    listData = newList.map(v => ({ ...v }));

    const savePath = "data/" + finalPath.replace(/^\/data\//, "");

    try {
      await saveJSON(savePath, newList);
      await syncFieldDetailByFields(newList);
    } catch (e) {
      alert(String(e?.message || e || "保存に失敗しました。"));
      return;
    }

    completeSaveModal("保存が完了しました");
    render();
  };
}
