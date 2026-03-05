export function renderCsvTable(rows) {
  const area = document.getElementById("csvTableArea");
  area.innerHTML = "";

  if (rows.length === 0) {
    area.textContent = "データなし";
    return;
  }

  const headers = Object.keys(rows[0]);
  const table = document.createElement("table");

  // ------------------------------
  // ヘッダー
  // ------------------------------
  const thead = document.createElement("thead");
  const trHead = document.createElement("tr");
  trHead.innerHTML = "<th>#</th>" + headers.map(h => `<th>${h}</th>`).join("");
  thead.appendChild(trHead);
  table.appendChild(thead);

  // ------------------------------
  // データ（編集可能）
  // ------------------------------
  const tbody = document.createElement("tbody");

  rows.forEach((row, idx) => {
    const tr = document.createElement("tr");

    // 行番号
    const tdIndex = document.createElement("td");
    tdIndex.textContent = idx + 1;
    tdIndex.dataset.rowIndex = idx;   // ★ 追加
    tdIndex.classList.add("row-index");
    tr.appendChild(tdIndex);

    // 各セル
    headers.forEach(h => {
      const td = document.createElement("td");
      td.textContent = row[h] ?? "";

      // ★ 編集可能にする
      td.contentEditable = true;

      // ★ 編集時に余計な改行を防ぐ
      td.addEventListener("keydown", e => {
        if (e.key === "Enter") {
          e.preventDefault();
          td.blur(); // Enter で確定
        }
      });

      // ★ 編集後に trim（前後の空白を削除）
      td.addEventListener("blur", () => {
        td.textContent = td.textContent.trim();
      });

      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  area.appendChild(table);
}