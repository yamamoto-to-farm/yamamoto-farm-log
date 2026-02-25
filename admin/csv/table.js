export function renderCsvTable(rows) {
  const area = document.getElementById("csvTableArea");
  area.innerHTML = "";

  if (rows.length === 0) {
    area.textContent = "データなし";
    return;
  }

  const headers = Object.keys(rows[0]);
  const table = document.createElement("table");

  // ヘッダー
  const thead = document.createElement("thead");
  const trHead = document.createElement("tr");
  trHead.innerHTML = "<th>#</th>" + headers.map(h => `<th>${h}</th>`).join("");
  thead.appendChild(trHead);
  table.appendChild(thead);

  // データ
  const tbody = document.createElement("tbody");
  rows.forEach((row, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML =
      `<td>${idx + 1}</td>` +
      headers.map(h => `<td>${row[h]}</td>`).join("");
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  area.appendChild(table);
}