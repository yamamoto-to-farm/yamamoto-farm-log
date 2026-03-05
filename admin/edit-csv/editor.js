// admin/edit-csv/editor.js

// 選択中の行インデックス（行番号クリックで更新）
let selectedRowIndex = null;

// テーブルに編集ロジックを紐づけて、rows を返す
export function attachEditor(tableElement) {
  const rows = [];

  // ヘッダー取得
  const headerCells = tableElement.querySelectorAll("thead th");
  const headers = Array.from(headerCells)
    .slice(1) // 先頭の「#」を除く
    .map(th => th.textContent);

  // 初期 rows をテーブルから復元
  const trList = tableElement.querySelectorAll("tbody tr");
  trList.forEach(tr => {
    const cells = tr.querySelectorAll("td");
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = cells[i + 1].textContent; // 先頭の「#」を除く
    });
    rows.push(obj);
  });

  // セル編集イベント（blur 時に rows に反映）
  tableElement.addEventListener(
    "blur",
    e => {
      if (e.target.tagName !== "TD") return;

      const td = e.target;
      const tr = td.parentElement;

      const rowIndex = tr.rowIndex - 1; // thead 分を引く
      const colIndex = td.cellIndex - 1; // 先頭の「#」を除く

      if (rowIndex < 0 || colIndex < 0) return;

      const key = headers[colIndex];
      rows[rowIndex][key] = td.textContent.trim();
    },
    true
  );

  // 行番号クリックで選択 / 解除
  tableElement.addEventListener("click", e => {
    if (!e.target.classList.contains("row-index")) return;

    const index = Number(e.target.dataset.rowIndex);

    // すでに選択されている行をもう一度クリック → 解除
    if (selectedRowIndex === index) {
      selectedRowIndex = null;

      // ハイライト解除
      tableElement.querySelectorAll("tr").forEach(tr => {
        tr.classList.remove("selected-row");
      });
      return;
    }

    // 新しく選択
    selectedRowIndex = index;

    // ハイライト更新
    tableElement.querySelectorAll("tr").forEach(tr => {
      tr.classList.remove("selected-row");
    });
    e.target.parentElement.classList.add("selected-row");
  });

  return rows;
}

// 選択中の行インデックスを返す
export function getSelectedRowIndex() {
  return selectedRowIndex;
}

// 行追加（末尾に空行を追加）
export function addRow(rows, headers) {
  const newRow = {};
  headers.forEach(h => {
    newRow[h] = ""; // 全部空欄で追加
  });
  rows.push(newRow);
}

// 行削除（選択行を削除）
export function deleteRow(rows, index) {
  if (index < 0 || index >= rows.length) return;
  rows.splice(index, 1);
  selectedRowIndex = null; // 削除後は選択解除
}