// admin/edit-csv/saver.js
import { saveLog } from "../../common/save/index.js";
import { enqueueSummaryUpdate } from "../../common/summary.js";

// ★ 追加：共通保存モーダル
import { updateSaveModal } from "../../common/save-modal.js";

export async function saveCsvFile(csvType, csvFile) {
  console.log("=== saveCsvFile START ===");
  console.log("csvType:", csvType, "csvFile:", csvFile);

  const table = document.querySelector("#csvTableArea table");
  if (!table) {
    console.error("❌ テーブルが見つかりません");
    updateSaveModal("テーブルがありません");
    return;
  }
  console.log("✔ table found:", table);

  // ------------------------------
  // 1. ヘッダー取得
  // ------------------------------
  const headerCells = table.querySelectorAll("thead th");
  const headers = Array.from(headerCells)
    .slice(1) // 先頭の "#" を除く
    .map(th => th.textContent.trim());

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
      obj[h] = (cells[i + 1].textContent || "").trim();
    });

    console.log(`row ${rowIndex}:`, obj);
    rows.push(obj);
  });

  // ------------------------------
  // 3. CSV 文字列に変換
  // ------------------------------
  const csvText = Papa.unparse(rows, {
    columns: headers,
    skipEmptyLines: true
  });

  console.log("=== FINAL CSV TEXT (Papa.unparse) ===\n" + csvText);

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

    // ★ alert → モーダルに置き換え
    updateSaveModal("CSV の保存が完了しました。サマリー更新を待っています…");

    // ------------------------------
    // 5. ★ サマリー更新（本丸）
    // ------------------------------
    console.log("=== summary update START ===");

    if (csvType === "planting" || csvType === "harvest" || csvType === "weight") {
      enqueueSummaryUpdate("*");
      console.log("summary target: ALL (*)");
    }

    console.log("=== summary update ENQUEUED ===");

  } catch (e) {
    console.error("❌ saveLog error:", e);
    updateSaveModal("保存に失敗しました（Console を確認してください）");
  }

  console.log("=== saveCsvFile END ===");
}