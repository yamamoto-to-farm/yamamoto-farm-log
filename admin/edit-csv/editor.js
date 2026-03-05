// admin/edit-csv/editor.js

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

  return rows;
}