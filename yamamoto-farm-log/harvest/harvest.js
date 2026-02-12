import { saveLog } from "../common/save/index.js";

async function saveHarvest() {
  const data = collectHarvestData(); // UIから取得
  const dateStr = data.harvestDate.replace(/-/g, "");

  const csvLine = [
    data.harvestDate,
    data.shippingDate,
    data.worker,
    data.field,
    data.amount,
    data.issue
  ].join(",");

  await saveLog("harvest", dateStr, data, csvLine);

  alert("保存しました！");
}