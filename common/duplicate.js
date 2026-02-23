// common/duplicate.js
import { loadCSV } from "./csv.js";

export async function checkDuplicate(category, entry) {
  const rows = await loadCSV(`${category}.csv`);

  if (category === "planting") {
    return checkPlanting(rows, entry);
  }
  if (category === "harvest") {
    return checkHarvest(rows, entry);
  }
  if (category === "shipping") {
    return checkShipping(rows, entry);
  }

  return { ok: true };
}

// ------------------------------
// planting
// ------------------------------
function checkPlanting(rows, e) {
  const dup = rows.find(r =>
    r.date === e.date &&
    r.field === e.field &&
    r.variety === e.variety &&
    r.quantity == e.quantity
  );

  if (dup) {
    return { ok: false, message: "同じ定植ログが既に存在します。" };
  }
  return { ok: true };
}

// ------------------------------
// harvest
// ------------------------------
function checkHarvest(rows, e) {
  const dup = rows.find(r =>
    r.plantingRef === e.plantingRef &&
    r.harvestDate === e.harvestDate &&
    r.shippingDate === e.shippingDate &&
    r.amount == e.amount

  );

  if (dup) {
    return { ok: false, message: "同じ収穫ログが既に存在します。" };
  }
  return { ok: true };
}

// ------------------------------
// shipping
// ------------------------------
function checkShipping(rows, e) {
  const dup = rows.find(r =>
    r.harvestRef === e.harvestRef &&
    r.weightIndex === e.weightIndex
  );

  if (dup) {
    return { ok: false, message: "この袋番号は既に登録されています。" };
  }
  return { ok: true };
}