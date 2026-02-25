// common/duplicate.js
import { loadCSV } from "./csv.js";

// =======================================
// 重複チェック（カテゴリ別に all.csv を読む）
// =======================================
export async function checkDuplicate(category, entry) {

  // ★ カテゴリごとに正しい CSV を読む
  let path = "";

  if (category === "planting") {
    path = "logs/planting/all.csv";
  } else if (category === "harvest") {
    path = "logs/harvest/all.csv";
  } else if (category === "shipping") {
    path = "logs/shipping/all.csv";
  } else {
    // 未対応カテゴリは常にOK
    return { ok: true };
  }

  // ★ CSV 読み込み（404 → 空配列になるよう loadCSV 側で処理）
  const rows = await loadCSV(path);

  // カテゴリ別チェック
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

// =======================================
// planting
// =======================================
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

// =======================================
// harvest
// =======================================
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

// =======================================
// shipping
// =======================================
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