import { loadFertilizerMaster } from "./list-utils.js?v=1";

export async function initFertilizerList() {
  const master = await loadFertilizerMaster();

  const container = document.getElementById("fertilizer-container");
  container.innerHTML = "";

  const table = createMasterTable(master);
  container.appendChild(table);
}
