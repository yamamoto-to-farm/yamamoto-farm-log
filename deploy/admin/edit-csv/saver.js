// admin/edit-csv/saver.js
import { saveLog } from "../../common/save/index.js";
import { enqueueSummaryUpdate } from "../../common/summary.js";

// ★ 共通保存モーダル
import { updateSaveModal } from "../../common/save-modal.js";

/* ---------------------------------------------------------
   デバッグ切り替え（localStorage）
   localStorage.setItem("debugEditCsv", "1") → ON
   localStorage.removeItem("debugEditCsv") → OFF
--------------------------------------------------------- */
function isDebug() {
  return localStorage.getItem("debugEditCsv") === "1";
}

function dbg(...args) {
  if (isDebug()) console.log("[edit-csv]", ...args);
}

/* ---------------------------------------------------------
   CSV 保存処理
--------------------------------------------------------- */
export async function saveCsvFile(csvType, csvFile) {
  dbg("=== saveCsvFile START ===");
  dbg("csvType:", csvType, "csvFile:", csvFile);

  const table = document.querySelector("#csvTableArea table");
  if (!table) {
    console.error("❌ テーブルが見つかりません");
    updateSaveModal("テーブルがありません");
    return;
  }
  dbg("✔ table found:", table);

  // ------------------------------
  // 1. ヘッダー取得
  // ------------------------------
  const headerCells = table.querySelectorAll("thead th");
  const headers = Array.from(headerCells)
    .slice(1) // 先頭の "#" を除く
    .map(th => th.textContent.trim());

  dbg("✔ headers:", headers);

  // ------------------------------
  // 2. 行データ取得
  // ------------------------------
  const rows = [];
  const trList = table.querySelectorAll("tbody tr");

  dbg("✔ tr count:", trList.length);

  trList.forEach((tr, rowIndex) => {
    const cells = tr.querySelectorAll("td");
    const obj = {};

    headers.forEach((h, i) => {
      obj[h] = (cells[i + 1].textContent || "").trim();
    });

    dbg(`row ${rowIndex}:`, obj);
    rows.push(obj);
  });

  // ------------------------------
  // 3. CSV 文字列に変換
  // ------------------------------
  const csvText = Papa.unparse(rows, {
    columns: headers,
    skipEmptyLines: true
  });

  dbg("=== FINAL CSV TEXT (Papa.unparse) ===\n" + csvText);

  // ------------------------------
  // 4. saveLog 経由で S3 に全書き換え保存
  // ------------------------------
  try {
    await saveLog(csvType, "all", {}, "", csvText, "csv-replace");

    // CloudFront の URL（loader.js と統一）
    const url = `https://d3sscxnlo0qnhe.cloudfront.net/logs/${csvType}/${csvFile}`;

    // 保存した内容をローカルキャッシュに即反映
    window._csvCache = window._csvCache || {};
    window._csvCache[url] = rows;

    updateSaveModal("CSV の保存が完了しました。サマリー更新を待っています…");

    // ------------------------------
    // 5. サマリー更新（本丸）
    // ------------------------------
    dbg("=== summary update START ===");

    if (csvType === "planting" || csvType === "harvest" || csvType === "weight") {
      enqueueSummaryUpdate("*");
      dbg("summary target: ALL (*)");
    }

    dbg("=== summary update ENQUEUED ===");

  } catch (e) {
    console.error("❌ saveLog error:", e);
    updateSaveModal("保存に失敗しました（Console を確認してください）");
  }

  dbg("=== saveCsvFile END ===");
}