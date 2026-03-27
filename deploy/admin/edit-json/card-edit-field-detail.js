// admin/edit-json/card-edit-field-detail.js
import { loadJSON, saveJSON } from "/common/json.js?v=2026031418";

export function renderEditCard({ dataName, fieldName, json, container }) {

  if (!fieldName) {
    container.innerHTML = `
      <div class="card">
        <div class="info-line">field パラメータが必要です。</div>
      </div>`;
    return;
  }

  const TEMPLATE = json["TEMPLATE_FIELD"];
  const data = json[fieldName] ? json[fieldName] : { ...TEMPLATE };

  // ============================
  // 基本情報カード
  // ============================
  container.insertAdjacentHTML("beforeend", `
    <div class="card">
      <h2>基本情報</h2>

      <div class="edit-line">
        <label>size</label>
        <input id="size" value="${data.size}">
      </div>

      <div class="edit-line">
        <label>memo</label>
        <textarea id="memo">${data.memo}</textarea>
      </div>
    </div>
  `);

  // ============================
  // parcels（筆情報）
  // ============================
  container.insertAdjacentHTML("beforeend", `
    <div class="card">
      <h2>parcels</h2>
      <div id="parcels-container"></div>
      <button id="add-parcel" class="secondary-btn">＋ 行追加</button>
    </div>
  `);

  const parcelsContainer = document.getElementById("parcels-container");
  parcelsContainer.innerHTML = "";

  data.parcels.forEach(p => {
    parcelsContainer.insertAdjacentHTML("beforeend", renderParcelRow(p));
  });

  document.getElementById("add-parcel").addEventListener("click", () => {
    parcelsContainer.insertAdjacentHTML("beforeend", renderParcelRow({
      address: "未入力",
      officialArea: "未入力",
      owner: "未入力",
      rightType: "未入力",
      rent: "未入力"
    }));
  });

  // ============================
  // contracts（契約情報）
  // ============================
  container.insertAdjacentHTML("beforeend", `
    <div class="card">
      <h2>contracts</h2>
      <div id="contracts-container"></div>
      <button id="add-contract" class="secondary-btn">＋ 行追加</button>
    </div>
  `);

  const contractsContainer = document.getElementById("contracts-container");
  contractsContainer.innerHTML = "";

  (data.contracts || []).forEach(c => {
    contractsContainer.insertAdjacentHTML("beforeend", renderContractRow(c));
  });

  document.getElementById("add-contract").addEventListener("click", () => {
    contractsContainer.insertAdjacentHTML("beforeend", renderContractRow({
      start: "未入力",
      end: "未入力",
      rent: "未入力",
      notes: "未入力"
    }));
  });

  // ============================
  // 保存ボタン
  // ============================
  container.insertAdjacentHTML("beforeend", `
    <button id="save-btn" class="primary-btn" style="margin-top:20px;">
      保存する
    </button>
  `);

  document.getElementById("save-btn").addEventListener("click", () => {
    saveFieldDetail(dataName, fieldName);
  });
}


// ============================
// parcels 行テンプレート
// ============================
function renderParcelRow(p) {
  return `
    <div class="parcel-row">
      <input class="parcel-address" value="${p.address}">
      <input class="parcel-area" value="${p.officialArea}">
      <input class="parcel-owner" value="${p.owner}">
      <input class="parcel-right" value="${p.rightType}">
      <input class="parcel-rent" value="${p.rent}">
    </div>
  `;
}


// ============================
// contracts 行テンプレート
// ============================
function renderContractRow(c) {
  return `
    <div class="contract-row">
      <input class="contract-start" value="${c.start}">
      <input class="contract-end" value="${c.end}">
      <input class="contract-rent" value="${c.rent}">
      <input class="contract-notes" value="${c.notes}">
    </div>
  `;
}


// ============================
// 保存処理（全文更新）
// ============================
async function saveFieldDetail(dataName, fieldName) {

  const size = document.getElementById("size").value;
  const memo = document.getElementById("memo").value;

  const parcels = [...document.querySelectorAll(".parcel-row")].map(row => ({
    address: row.querySelector(".parcel-address").value,
    officialArea: row.querySelector(".parcel-area").value,
    owner: row.querySelector(".parcel-owner").value,
    rightType: row.querySelector(".parcel-right").value,
    rent: row.querySelector(".parcel-rent").value
  }));

  const contracts = [...document.querySelectorAll(".contract-row")].map(row => ({
    start: row.querySelector(".contract-start").value,
    end: row.querySelector(".contract-end").value,
    rent: row.querySelector(".contract-rent").value,
    notes: row.querySelector(".contract-notes").value
  }));

  const newData = {
    size,
    memo,
    parcels,
    contracts
  };

  // ============================
  // ★ JSON 全体更新（replace-json.js 不要）
  // ============================
  const fileName = `${dataName}.json`;

  const current = await loadJSON(`/data/${fileName}`);
  current[fieldName] = newData;

  await saveJSON(`data/${fileName}`, current);

  alert("保存しました");
  location.href = `/analysis/?field=${encodeURIComponent(fieldName)}`;
}