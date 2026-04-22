// =======================================
// plantingList.js（定植一覧の描画ロジック）
// =======================================

// CSV 読み込み
async function loadPlantingCSV() {
  const response = await fetch("../data/planting/all.csv");
  const text = await response.text();
  return Papa.parse(text, { header: true }).data;
}

// フィルタ UI の初期化（既存コードをそのまま移植）
function initPlantingFilters(data) {
  // ★あなたの既存のフィルタ生成ロジックをそのまま移植
  // 年月・圃場・品種の抽出 → モーダル生成 → activeFilters 表示
}

// テーブル描画
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
        <td><button class="delete-btn" data-id="${row.id}">削除</button></td>
      </tr>
    `;
  });

  table.innerHTML = html;
}

// メイン処理
async function renderPlantingList() {
  const data = await loadPlantingCSV();

  initPlantingFilters(data);
  renderPlantingTable(data);
}
