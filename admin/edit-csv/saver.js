// admin/edit-csv/saver.js
import { saveLog } from "../../common/save/index.js";

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

  const csvText = csvLines.join("\n").trimEnd();

  console.log("=== FINAL CSV TEXT ===\n" + csvText);

  // ------------------------------
  // 4. saveLog 経由で S3 に全書き換え保存
  // ------------------------------
  try {
    await saveLog(csvType, "all", {}, "", csvText, "csv-replace");

    // ★ CloudFront の URL（loader.js と統一）
    const url = `https://d3sscxnlo0qnhe.cloudfront.net/logs/${csvType}/${csvFile}`;

    // ★ 保存した内容をローカルキャッシュに即反映
    window._csvCache = window._csvCache || {};
    window._csvCache[url] = rows;

    alert("CSV を保存しました（S3 に全書き換え）");

    // ------------------------------
    // 5. ★ サマリー更新（本丸）
    // ------------------------------
    console.log("=== summary update START ===");

    // plantingRef を含む CSV の場合のみサマリー更新
    if (csvType === "planting" || csvType === "harvest" || csvType === "weight") {

      // 1) plantingRef を全部抽出
      const plantingRefs = rows
        .map(r => r.plantingRef)
        .filter(ref => ref && ref.trim() !== "");

      // 2) 重複排除
      const uniqueRefs = [...new Set(plantingRefs)];

      console.log("summary targets:", uniqueRefs);

      // 3) それぞれサマリー更新キューに投入
      for (const ref of uniqueRefs) {
        window.enqueueSummaryUpdate(ref);
      }
    }

    console.log("=== summary update ENQUEUED ===");

  } catch (e) {
    console.error("❌ saveLog error:", e);
    alert("保存に失敗しました（Console を確認してください）");
  }

  console.log("=== saveCsvFile END ===");
}