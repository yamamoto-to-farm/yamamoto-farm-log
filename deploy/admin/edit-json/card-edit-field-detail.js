// admin/edit-json/card-edit-field-detail.js
import { loadJSON, saveJSON } from "/common/json.js?v=1";
import { showSaveModal, completeSaveModal } from "/common/save-modal.js?v=1";

function normalizeBlank(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (["未入力", "未入力（a）", "未入力（㎡）", "未設定"].includes(text)) return "";
  return String(value ?? "");
}

function normalizeParcel(parcel = {}) {
  return {
    address: normalizeBlank(parcel.address),
    officialArea: normalizeBlank(parcel.officialArea),
    owner: normalizeBlank(parcel.owner),
    ownerAddress: normalizeBlank(parcel.ownerAddress),
    rightType: normalizeBlank(parcel.rightType),
    rent: normalizeBlank(parcel.rent)
  };
}

function normalizeContract(contract = {}) {
  return {
    start: normalizeBlank(contract.start),
    end: normalizeBlank(contract.end),
    rent: normalizeBlank(contract.rent),
    notes: normalizeBlank(contract.notes)
  };
}

function parseRentNumber(value) {
  const text = String(value ?? "").replace(/,/g, "").trim();
  if (!text) return 0;

  const matched = text.match(/-?\d+(?:\.\d+)?/);
  if (!matched) return 0;

  const num = Number(matched[0]);
  return Number.isFinite(num) ? num : 0;
}

function formatRentNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "";
  return num.toLocaleString("ja-JP");
}

function calcParcelRentTotal() {
  const inputs = document.querySelectorAll(".parcel-rent");
  let sum = 0;
  inputs.forEach(input => {
    sum += parseRentNumber(input?.value || "");
  });
  return sum;
}

function updateParcelRentTotalHint() {
  const hintEl = document.getElementById("contract-rent-total-hint");
  if (!hintEl) return;
  const total = calcParcelRentTotal();
  hintEl.textContent = `筆情報の賃料（10aあたり）合計: ${formatRentNumber(total)}`;
}

function applyParcelRentTotalToContractRents({ onlyEmpty = false } = {}) {
  const totalText = formatRentNumber(calcParcelRentTotal());
  const rentInputs = document.querySelectorAll(".contract-rent");

  rentInputs.forEach(input => {
    if (!input) return;
    if (onlyEmpty && String(input.value || "").trim()) return;
    input.value = totalText;
  });

  updateParcelRentTotalHint();
}

function bindParcelRentEvents() {
  document.querySelectorAll(".parcel-rent").forEach(input => {
    input.oninput = () => {
      updateParcelRentTotalHint();
    };
  });
}

export function renderEditCard({ dataName, fieldName, json, container }) {

  if (!fieldName) {
    container.innerHTML = `
      <div class="card">
        <div class="info-line">field パラメータが必要です。</div>
      </div>`;
    return;
  }

  /* ----------------------------------------
     ★ 圃場名入りタイトルに変更（analysis と統一）
  ---------------------------------------- */
  const title = document.getElementById("page-title");
  if (title) {
    title.textContent = `管理データ編集（${fieldName}）`;
  }

  const TEMPLATE = json["TEMPLATE_FIELD"];
  const rawData = json[fieldName] ? json[fieldName] : { ...TEMPLATE };
  const data = {
    ...rawData,
    size: normalizeBlank(rawData.size),
    memo: normalizeBlank(rawData.memo),
    parcels: Array.isArray(rawData.parcels) && rawData.parcels.length > 0
      ? rawData.parcels.map(normalizeParcel)
      : [normalizeParcel({})],
    contracts: Array.isArray(rawData.contracts) && rawData.contracts.length > 0
      ? rawData.contracts.map(normalizeContract)
      : [normalizeContract({})]
  };

  // ============================
  // 基本情報カード
  // ============================
  container.insertAdjacentHTML("beforeend", `
    <div class="card">
      <h2>基本情報</h2>

      <div class="edit-line">
        <label>耕作面積（反）</label>
        <input id="size" value="${data.size}">
      </div>

      <div class="edit-line">
        <label>メモ（memo）</label>
        <textarea id="memo">${data.memo}</textarea>
      </div>
    </div>
  `);

  // ============================
  // parcels（筆情報）
  // ============================
  container.insertAdjacentHTML("beforeend", `
    <div class="card">
      <h2>筆情報（parcels）</h2>

      <!-- ★ ラベル行 -->
      <div class="parcel-header">
        <div>所在</div>
        <div>登記面積（㎡）</div>
        <div>所有者：氏名</div>
        <div>所有者：住所</div>
        <div>権利</div>
        <div>賃料（10aあたり）</div>
      </div>

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
    parcelsContainer.insertAdjacentHTML("beforeend", renderParcelRow(normalizeParcel({})));
    bindParcelRentEvents();
    updateParcelRentTotalHint();
  });

  // ============================
  // contracts（契約情報）
  // ============================
  container.insertAdjacentHTML("beforeend", `
    <div class="card">
      <h2>契約情報（contracts）</h2>

      <!-- ★ ラベル行 -->
      <div class="contract-header">
        <div>開始日</div>
        <div>終了日</div>
        <div>賃料（合計）</div>
        <div>備考</div>
      </div>

      <div style="display:flex; gap:8px; align-items:center; margin-bottom:8px; flex-wrap:wrap;">
        <div id="contract-rent-total-hint" style="color:#555; font-size:13px;"></div>
        <button id="apply-parcel-rent-total-btn" class="secondary-btn" type="button">筆情報合計を反映</button>
      </div>

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
    contractsContainer.insertAdjacentHTML("beforeend", renderContractRow(normalizeContract({})));
    applyParcelRentTotalToContractRents({ onlyEmpty: true });
  });

  document.getElementById("apply-parcel-rent-total-btn").addEventListener("click", () => {
    applyParcelRentTotalToContractRents({ onlyEmpty: false });
  });

  bindParcelRentEvents();
  applyParcelRentTotalToContractRents({ onlyEmpty: true });

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


/* ============================
   parcels 行テンプレート
============================ */
function renderParcelRow(p) {
  return `
    <div class="parcel-row">
      <input class="parcel-address" value="${p.address}">
      <input class="parcel-area" value="${p.officialArea}">
      <input class="parcel-owner" value="${p.owner}">
      <input class="parcel-owner-address" value="${p.ownerAddress}">
      <input class="parcel-right" value="${p.rightType}">
      <input class="parcel-rent" value="${p.rent}">
    </div>
  `;
}


/* ============================
   contracts 行テンプレート
============================ */
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


/* ============================
   保存処理（全文更新＋保存モーダル）
============================ */
async function saveFieldDetail(dataName, fieldName) {

  const size = document.getElementById("size").value;
  const memo = document.getElementById("memo").value;

  const parcels = [...document.querySelectorAll(".parcel-row")].map(row => ({
    address: row.querySelector(".parcel-address").value,
    officialArea: row.querySelector(".parcel-area").value,
    owner: row.querySelector(".parcel-owner").value,
    ownerAddress: row.querySelector(".parcel-owner-address").value,
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

  // ★ 保存モーダル開始
  showSaveModal("保存しています…");

  const fileName = `${dataName}.json`;

  const current = await loadJSON(`/data/${fileName}`);
  current[fieldName] = newData;

  await saveJSON(`data/${fileName}`, current);

  // ★ 保存完了モーダル
  completeSaveModal("保存が完了しました");

  setTimeout(() => {
    location.href = `/fields/?field=${encodeURIComponent(fieldName)}`;
  }, 800);
}
