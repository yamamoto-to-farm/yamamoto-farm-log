// admin/edit-csv/saver.js
import { writeText } from "../../common/github.js";

export async function saveCsvFile(csvType, csvFile) {
  console.log("=== saveCsvFile START ===");
  console.log("csvType:", csvType, "csvFile:", csvFile);

  const table = document.querySelector("#csvTableArea table");
  if (!table) {
    console.error("❌ テーブルが見つかりません");
    alert("テーブルがありません");
    return;
  }
  console.log("✔ table found:", table);

  // ------------------------------
  // 1. ヘッダー取得
  // ------------------------------
  const headerCells = table.querySelectorAll("thead th");
  const headers = Array.from(headerCells)
    .slice(1) // 先頭の "#" を除く
    .map(th => th.textContent);

  console.log("✔ headers:", headers);

  // ------------------------------
  // 2. 行データ取得
  // ------------------------------
  const rows = [];
  const trList = table.querySelectorAll("tbody tr");

  console.log("✔ tr count:", trList.length);

  trList.forEach((tr, rowIndex) => {
    const cells = tr.querySelectorAll("td");
    const obj = {};

    headers.forEach((h, i) => {
      obj[h] = cells[i + 1].textContent; // 先頭の "#" を除く
    });

    console.log(`row ${rowIndex}:`, obj);
    rows.push(obj);
  });

  // ------------------------------
  // 3. CSV 文字列に変換
  // ------------------------------
  const csvLines = [];

  csvLines.push(headers.join(","));

  rows.forEach((row, i) => {
    const line = headers.map(h => row[h] ?? "").join(",");
    csvLines.push(line);
    console.log(`csv line ${i}:`, line);
  });

  const csvText = csvLines.join("\n") + "\n";

  console.log("=== FINAL CSV TEXT ===\n" + csvText);

  // ------------------------------
  // 4. GitHub に保存（全書き換え）
  // ------------------------------
  const path = `logs/${csvType}/${csvFile}`;
  console.log("✔ writeText path:", path);

  try {
    const result = await writeText(path, csvText);
    console.log("✔ writeText result:", result);
    alert("CSV を保存しました（全行を上書きしました）");
  } catch (e) {
    console.error("❌ writeText error:", e);
    alert("保存に失敗しました（Console を確認してください）");
  }

  console.log("=== saveCsvFile END ===");
}