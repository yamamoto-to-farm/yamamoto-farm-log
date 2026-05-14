import { loadFertilizerMaster } from "./list-utils.js?v=1";

/* ============================================================
   初期化
============================================================ */
export async function initFertilizerList() {
  const master = await loadFertilizerMaster();

  const container = document.getElementById("fertilizer-container");
  container.innerHTML = "";

  const table = createMasterTable(master);
  container.appendChild(table);
}

/* ============================================================
   肥料マスター一覧テーブル生成
============================================================ */
function createMasterTable(master) {
  const table = document.createElement("table");
  table.className = "fert-master-table";

  const thead = document.createElement("thead");
  thead.innerHTML = `
    <tr>
      <th>ID</th>
      <th>カテゴリ</th>
      <th>肥料名</th>
      <th>容量（kg）</th>
    </tr>
  `;
  table.appendChild(thead);

  const tbody = document.createElement("tbody");

  master.forEach(fert => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${fert.id}</td>
      <td>${fert.category}</td>
      <td>${fert.name}</td>
      <td>${fert.capacity}</td>
    `;

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);

  return table;
}
