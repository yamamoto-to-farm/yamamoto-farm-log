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

  // 行番号（#）
  const thIndex = document.createElement("th");
  thIndex.textContent = "#";
  trHead.appendChild(thIndex);

  // 各列ヘッダー（ソート用 data-key 付き）
  headers.forEach(h => {
    const th = document.createElement("th");
    th.textContent = h;
    th.dataset.key = h;   // ← ★ ソート用キー
    th.classList.add("sortable"); // CSSでカーソル変更などに使える
    trHead.appendChild(th);
  });

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
    tdIndex.dataset.rowIndex = idx;
    tdIndex.classList.add("row-index");
    tr.appendChild(tdIndex);

    // 各セル
    headers.forEach(h => {
      const td = document.createElement("td");
      td.textContent = row[h] ?? "";
      td.contentEditable = true;

      // Enter で確定（改行禁止）
      td.addEventListener("keydown", e => {
        if (e.key === "Enter") {
          e.preventDefault();
          td.blur();
        }
      });

      // blur 時に trim
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