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
// フィルタ UI の生成（折りたたみ式）
// -------------------------------
function initPlantingFilters(data) {
  const filterCard = document.getElementById("filter-card");
  const activeFilters = document.getElementById("activeFilters");

  // 年月・圃場・品種のセット
  const ymSet = new Set();
  const fieldSet = new Set();
  const varietySet = new Set();

  data.forEach(row => {
    if (row.plantDate) ymSet.add(row.plantDate.slice(0, 7));
    if (row.field) fieldSet.add(row.field);
    if (row.variety) varietySet.add(row.variety);
  });

  const ymList = [...ymSet].sort().reverse();
  const fieldList = [...fieldSet].sort();
  const varietyList = [...varietySet].sort();

  // 折りたたみ式フィルタ生成
  filterCard.innerHTML = `
    ${createFilterBlock("年月", "ym", ymList)}
    ${createFilterBlock("圃場", "field", fieldList)}
    ${createFilterBlock("品種", "variety", varietyList)}
  `;

  // イベント付与
  attachFilterEvents(data);

  // 初期表示
  activeFilters.innerHTML = "";
}

// -------------------------------
// フィルタブロック生成
// -------------------------------
function createFilterBlock(label, key, items) {
  return `
    <div class="filter-block" data-key="${key}">
      <div class="filter-header">
        <span class="filter-label">${label}</span>
        <span class="filter-toggle-btn">▼</span>
      </div>
      <div class="filter-children">
        ${items.map(v => `<div class="select-item" data-value="${v}">${v}</div>`).join("")}
      </div>
    </div>
  `;
}

// -------------------------------
// フィルタイベント付与
// -------------------------------
function attachFilterEvents(data) {
  // 折りたたみ
  document.querySelectorAll(".filter-header").forEach(header => {
    header.addEventListener("click", () => {
      header.parentElement.classList.toggle("open");
    });
  });

  // select-item クリック
  document.querySelectorAll(".select-item").forEach(item => {
    item.addEventListener("click", () => {
      const key = item.closest(".filter-block").dataset.key;
      const value = item.dataset.value;

      // 選択状態トグル
      if (item.classList.contains("selected")) {
        item.classList.remove("selected");
      } else {
        // 同じカテゴリは単一選択
        item.closest(".filter-children")
            .querySelectorAll(".select-item")
            .forEach(i => i.classList.remove("selected"));
        item.classList.add("selected");
      }

      applyPlantingFilters(data);
    });
  });
}

// -------------------------------
// フィルタ適用
// -------------------------------
function applyPlantingFilters(data) {
  const ym = getSelectedValue("ym");
  const field = getSelectedValue("field");
  const variety = getSelectedValue("variety");

  let filtered = data;

  if (ym) filtered = filtered.filter(r => r.plantDate?.startsWith(ym));
  if (field) filtered = filtered.filter(r => r.field === field);
  if (variety) filtered = filtered.filter(r => r.variety === variety);

  updateActiveFilters({ ym, field, variety });
  renderPlantingTable(filtered);
}

// -------------------------------
// 選択中フィルタ取得
// -------------------------------
function getSelectedValue(key) {
  const block = document.querySelector(`.filter-block[data-key="${key}"]`);
  if (!block) return "";
  const selected = block.querySelector(".select-item.selected");
  return selected ? selected.dataset.value : "";
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
