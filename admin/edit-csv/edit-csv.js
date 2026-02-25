import { loadCSV } from "./loader.js";
import { renderCsvTable } from "./table.js";

console.log("=== admin/edit-csv/edit-csv.js loaded ===");

document.getElementById("loadCsvBtn").addEventListener("click", async () => {
  const type = document.getElementById("csvType").value;
  const file = document.getElementById("csvFile").value;

  const url = `../../logs/${type}/${file}`;
  console.log("[admin] CSV 読み込み:", url);

  const rows = await loadCSV(url);
  renderCsvTable(rows);
});