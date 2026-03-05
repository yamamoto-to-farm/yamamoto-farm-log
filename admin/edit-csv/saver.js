// admin/edit-csv/saver.js
import { writeText } from "../../common/github.js";

export async function saveCsvFile(csvType, csvFile) {
  const table = document.querySelector("#csvTableArea table");
  if (!table) {
    alert("テーブルがありません");
    return;
  }

  // ------------------------------
  // 1. ヘッダー取得
  // ------------------------------
  const headerCells = table.querySelectorAll("thead th");
  const headers = Array.from(headerCells)
    .slice(1) // 先頭の "#" を除く
    .map(th => th.textContent);

  // ------------------------------
  // 2. 行データ取得
  // ------------------------------
  const rows = [];
  const trList = table.querySelectorAll("tbody tr");

  trList.forEach(tr => {
    const cells = tr.querySelectorAll("td");
    const obj = {};

    headers.forEach((h, i) => {
      obj[h] = cells[i + 1].textContent; // 先頭の "#" を除く
    });

    rows.push(obj);
  });

  // ------------------------------
  // 3. CSV 文字列に変換
  // ------------------------------
  const csvLines = [];

  // ヘッダー行
  csvLines.push(headers.join(","));

  // データ行
  rows.forEach(row => {
    const line = headers.map(h => row[h] ?? "").join(",");
    csvLines.push(line);
  });

  const csvText = csvLines.join("\n") + "\n";

  // ------------------------------
  // 4. GitHub に保存（全書き換え）
  // ------------------------------
  const path = `logs/${csvType}/${csvFile}`;

  await writeText(path, csvText);

  alert("CSV を保存しました（全行を上書きしました）");
}