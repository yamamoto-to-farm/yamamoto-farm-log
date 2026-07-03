import { openInfoModal } from "./modal-base.js?v=1";

function formatPrice(price) {
  if (!price || typeof price !== "object" || Array.isArray(price)) return "";
  return Object.entries(price)
    .map(([month, value]) => `${month}: ${value}`)
    .join("\n");
}

function formatArray(value) {
  if (!Array.isArray(value)) return "";
  return value
    .map(v => (typeof v === "string" ? v : JSON.stringify(v)))
    .join("\n");
}

export function openFertilizerInfoModal(detail = {}) {
  const title = `${detail.name || "肥料"} (${detail.id || "ID不明"})`;
  const reg = detail.registration || {};
  const holder = reg.holder || {};

  openInfoModal({
    title,
    rows: [
      { label: "カテゴリ", value: detail.category || "" },
      { label: "メーカー", value: detail.maker || "" },
      { label: "容量", value: detail.capacity != null ? `${detail.capacity}` : "" },
      { label: "N", value: detail.n != null ? `${detail.n}` : "" },
      { label: "P", value: detail.p != null ? `${detail.p}` : "" },
      { label: "K", value: detail.k != null ? `${detail.k}` : "" },
      { label: "登録番号", value: reg.number || "" },
      { label: "肥料の種類", value: reg.fertilizerType || "" },
      { label: "法区分", value: reg.legalClassification || "" },
      { label: "登録者", value: holder.name || "" },
      { label: "登録者所在地", value: holder.address || "" },
      { label: "登録年月日", value: reg.registeredAt || "" },
      { label: "成分情報", value: formatArray(detail.ingredients) },
      { label: "施用目安", value: formatArray(detail.applicationGuidelines) },
      { label: "月別価格", value: formatPrice(detail.price) },
      { label: "メモ", value: detail.notes || "" }
    ]
  });
}
