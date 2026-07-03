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

  let listData = Array.isArray(json)
    ? json
    : Object.values(json || {});

  container.insertAdjacentHTML("beforeend", `
    <div class="card">
      <h2>圃場一覧</h2>
      <p style="margin:0 0 12px; color:#555;">
        圃場名を追加・削除して保存すると、field-detail.json も同じ圃場名で自動同期されます。
      </p>
      <div id="field-list"></div>

      <button id="add-field-btn" class="primary-btn" style="margin-top:20px;">
        ＋ 圃場を追加
      </button>

      <button id="save-btn" class="primary-btn" style="margin-top:20px;">
        保存する
      </button>
    </div>
  `);

  const listEl = document.getElementById("field-list");

  function render() {
    listEl.innerHTML = "";

    listData.forEach((item, index) => {
      const name = item.name ?? "";
      const area = item.area ?? "";
      const address = Array.isArray(item.address)
        ? item.address.join(" / ")
        : "";
      const lat = item.lat ?? "";
      const lng = item.lng ?? "";

      const detailHref = `?data=field-detail&field=${encodeURIComponent(name)}`;

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
            <button class="secondary-btn jump-detail-btn" data-index="${index}" ${name ? "" : "disabled"}>
              詳細を開く
            </button>
            <button class="secondary-btn delete-field-btn" data-index="${index}">
              削除
            </button>
          </div>

          <a class="detail-link" href="${detailHref}" style="display:none;">detail</a>
        </div>
      `);
    });

    document.querySelectorAll(".delete-field-btn").forEach(btn => {
      btn.onclick = () => {
        const idx = Number(btn.dataset.index);
        if (!confirm("この圃場を削除しますか？\n保存時に field-detail からも削除されます。")) return;
        listData.splice(idx, 1);
        render();
      };
    });

    document.querySelectorAll(".jump-detail-btn").forEach(btn => {
      btn.onclick = () => {
        const idx = Number(btn.dataset.index);
        const row = btn.closest(".sub-card");
        const nameInput = row?.querySelector(".field-name");
        const name = nameInput?.value.trim() || "";

        if (!name) {
          alert("先に圃場名を入力してください。");
          return;
        }

        location.href = `?data=field-detail&field=${encodeURIComponent(name)}`;
      };
    });
  }

  render();

  document.getElementById("add-field-btn").onclick = () => {
    listData.push({
      name: "",
      area: "",
      address: [],
      lat: "",
      lng: ""
    });
    render();
  };

  document.getElementById("save-btn").onclick = async () => {
    showSaveModal("保存しています…");

    const names = container.querySelectorAll(".field-name");
    const areas = container.querySelectorAll(".field-area");
    const addresses = container.querySelectorAll(".field-address");
    const lats = container.querySelectorAll(".field-lat");
    const lngs = container.querySelectorAll(".field-lng");

    const newList = [];
    const usedNames = new Set();

    for (let i = 0; i < names.length; i += 1) {
      const name = names[i].value.trim();
      const area = areas[i].value.trim();
      const address = parseAddressInput(addresses[i].value);
      const latRaw = lats[i].value.trim();
      const lngRaw = lngs[i].value.trim();

      if (!name && !area) {
        continue;
      }

      if (!name) {
        alert("圃場名が空の行があります。圃場名を入力してください。");
        return;
      }

      if (usedNames.has(name)) {
        alert(`圃場名「${name}」が重複しています。`);
        return;
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

    const savePath = "data/" + finalPath.replace(/^\/data\//, "");

    await saveJSON(savePath, newList);
    await syncFieldDetailByFields(newList);

    completeSaveModal("保存が完了しました");
  };
}
