// =======================================
// plantingList.js（定植一覧の描画ロジック）
// =======================================

// -------------------------------
// CSV 読み込み
// -------------------------------
async function loadPlantingCSV() {
  const response = await fetch("../logs/planting/all.csv");
  const text = await response.text();
  return Papa.parse(text, { header: true }).data.filter(r => r.id);
}

// -------------------------------
// フィルタ UI の生成
// -------------------------------
function initPlantingFilters(data) {
  const filterCard = document.getElementById("filter-card");
  const activeFilters = document.getElementById("activeFilters");

  // 年月一覧
  const ymSet = new Set();
  // 圃場一覧
  const fieldSet = new Set();
  // 品種一覧
  const varietySet = new Set();

  data.forEach(row => {
    if (row.plantDate) ymSet.add(row.plantDate.slice(0, 7));
    if (row.field) fieldSet.add(row.field);
    if (row.variety) varietySet.add(row.variety);
  });

  const ymList = [...ymSet].sort().reverse();
  const fieldList = [...fieldSet].sort();
  const varietyList = [...varietySet].sort();

  filterCard.innerHTML = `
    <div class="filter-group">
      <label>年月</label>
      <select id="filterYM" class="form-input">
        <option value="">すべて</option>
        ${ymList.map(v => `<option value="${v}">${v}</option>`).join("")}
      </select>
    </div>

    <div class="filter-group">
      <label>圃場</label>
      <select id="filterField" class="form-input">
        <option value="">すべて</option>
        ${fieldList.map(v => `<option value="${v}">${v}</option>`).join("")}
      </select>
    </div>

    <div class="filter-group">
      <label>品種</label>
      <select id="filterVariety" class="form-input">
        <option value="">すべて</option>
        ${varietyList.map(v => `<option value="${v}">${v}</option>`).join("")}
      </select>
    </div>
  `;

  // フィルタ変更イベント
  ["filterYM", "filterField", "filterVariety"].forEach(id => {
    document.getElementById(id).addEventListener("change", () => {
      applyPlantingFilters(data);
    });
  });

  // 初期表示
  activeFilters.innerHTML = "";
}

// -------------------------------
// フィルタ適用
// -------------------------------
function applyPlantingFilters(data) {
  const ym = document.getElementById("filterYM").value;
  const field = document.getElementById("filterField").value;
  const variety = document.getElementById("filterVariety").value;

  let filtered = data;

  if (ym) filtered = filtered.filter(r => r.plantDate?.startsWith(ym));
  if (field) filtered = filtered.filter(r => r.field === field);
  if (variety) filtered = filtered.filter(r => r.variety === variety);

  updateActiveFilters({ ym, field, variety });
  renderPlantingTable(filtered);
}

// -------------------------------
// 選択中フィルタ表示
// -------------------------------
function updateActiveFilters({ ym, field, variety }) {
  const box = document.getElementById("activeFilters");
  const tags = [];

  if (ym) tags.push(`<span class="filter-tag">${ym}</span>`);
  if (field) tags.push(`<span class="filter-tag">${field}</span>`);
  if (variety) tags.push(`<span class="filter-tag">${variety}</span>`);

  box.innerHTML = tags.join("");
}

// -------------------------------
// テーブル描画
// -------------------------------
function renderPlantingTable(data) {
  const table = document.getElementById("plantingTable");

  let html = `
    <tr>
      <th>定植日</th>
      <th>圃場</th>
      <th>品種</th>
      <th>面積(反)</th>
      <th>播種日</th>
      <th class="operation-col">操作</th>
    </tr>
  `;

  data.forEach(row => {
    html += `
      <tr>
        <td>${row.plantDate || ""}</td>
        <td>${row.field || ""}</td>
        <td>${row.variety || ""}</td>
        <td>${row.area || ""}</td>
        <td>${row.seedDate || ""}</td>
        <td>
          <button class="discard-btn" data-id="${row.id}">
            破棄・植え直し
          </button>
        </td>
      </tr>
    `;
  });

  table.innerHTML = html;

  // 破棄ボタン → discard-planting.html に遷移
  document.querySelectorAll(".discard-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      window.location.href = `/planting/discard-planting.html?plantingRef=${id}`;
    });
  });
}

// -------------------------------
// メイン処理
// -------------------------------
async function renderPlantingList() {
  const data = await loadPlantingCSV();

  initPlantingFilters(data);
  renderPlantingTable(data);
}
