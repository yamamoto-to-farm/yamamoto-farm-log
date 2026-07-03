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

function uniqueNonEmpty(values) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map(v => String(v || "").trim())
    .filter(Boolean)));
}

export function openFertilizerInfoModal(detail = {}) {
  const title = `${detail.name || "肥料"} (${detail.id || "ID不明"})`;
  const activeIngredients = uniqueNonEmpty([
    ...(Array.isArray(detail.activeIngredients) ? detail.activeIngredients : []),
    ...(Array.isArray(detail.ingredients) ? detail.ingredients.map(v => v?.name) : [])
  ]);
  const crops = uniqueNonEmpty([
    ...(Array.isArray(detail.targetCrops) ? detail.targetCrops : []),
    ...(Array.isArray(detail.applications) ? detail.applications.map(v => v?.crop) : []),
    ...(Array.isArray(detail.applicationGuidelines) ? detail.applicationGuidelines.map(v => v?.crop) : [])
  ]);
  const applications = Array.isArray(detail.applications)
    ? detail.applications
    : (Array.isArray(detail.applicationGuidelines) ? detail.applicationGuidelines : []);

  openInfoModal({
    title,
    rows: [
      { label: "カテゴリ", value: detail.category || "" },
      { label: "メーカー", value: detail.maker || "" },
      { label: "容量", value: detail.capacity != null ? `${detail.capacity}` : "" },
      { label: "N", value: detail.n != null ? `${detail.n}` : "" },
      { label: "P", value: detail.p != null ? `${detail.p}` : "" },
      { label: "K", value: detail.k != null ? `${detail.k}` : "" },
      { label: "主成分", value: formatArray(activeIngredients) },
      { label: "対象作物", value: formatArray(crops) },
      { label: "成分情報", value: formatArray(detail.ingredients) },
      { label: "施用目安", value: formatArray(applications) },
      { label: "月別価格", value: formatPrice(detail.price) },
      { label: "メモ", value: detail.notes || "" }
    ]
  });
}
