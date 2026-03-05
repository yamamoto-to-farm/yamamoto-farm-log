// admin/edit-csv/edit-csv.js

import { loadCSV } from "./loader.js";
import { renderCsvTable } from "./table.js";
import { saveCsvFile } from "./saver.js";

console.log("=== admin/edit-csv/edit-csv.js loaded ===");

// CSV 読み込み
document.getElementById("loadCsvBtn").addEventListener("click", async () => {
  const type = document.getElementById("csvType").value;
  const file = document.getElementById("csvFile").value;

  const url = `../../logs/${type}/${file}`;
  console.log("[admin] CSV 読み込み:", url);

  const rows = await loadCSV(url);
  renderCsvTable(rows);
});

// CSV 保存（全書き換え）
document.getElementById("saveCsvBtn").addEventListener("click", async () => {
  const type = document.getElementById("csvType").value;
  const file = document.getElementById("csvFile").value;

  await saveCsvFile(type, file);
});