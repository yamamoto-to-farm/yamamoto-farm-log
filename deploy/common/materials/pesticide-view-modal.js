import { openInfoModal } from "./modal-base.js?v=1";

function formatPrice(price) {
  if (!price || typeof price !== "object" || Array.isArray(price)) return "";
  return Object.entries(price)
    .map(([month, value]) => `${month}: ${value}`)
    .join("\n");
}

function formatArray(value) {
  return Array.isArray(value) ? value.join("\n") : "";
}

function uniqueNonEmpty(values) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map(v => String(v || "").trim())
    .filter(Boolean)));
}

export function openPesticideInfoModal(detail = {}) {
  const title = `${detail.name || "農薬"} (${detail.id || "ID不明"})`;
  const ingredients = uniqueNonEmpty([
    ...(Array.isArray(detail.activeIngredients) ? detail.activeIngredients : []),
    ...(Array.isArray(detail.ingredients) ? detail.ingredients.map(v => v?.name) : [])
  ]);
  const crops = uniqueNonEmpty([
    ...(Array.isArray(detail.targetCrops) ? detail.targetCrops : []),
    ...(Array.isArray(detail.applications) ? detail.applications.map(v => v?.crop) : [])
  ]);
  const pests = uniqueNonEmpty([
    ...(Array.isArray(detail.targetPests) ? detail.targetPests : []),
    ...(Array.isArray(detail.applications) ? detail.applications.map(v => v?.target) : [])
  ]);

  openInfoModal({
    title,
    rows: [
      { label: "カテゴリ", value: detail.category || "" },
      { label: "メーカー", value: detail.maker || "" },
      { label: "単位", value: detail.unit || "" },
      { label: "登録番号", value: detail.registrationNo || "" },
      { label: "剤型", value: detail.formulation || "" },
      { label: "抵抗性コード", value: detail.resistanceCode || "" },
      { label: "有効成分", value: formatArray(ingredients) },
      { label: "対象作物", value: formatArray(crops) },
      { label: "対象病害虫/雑草", value: formatArray(pests) },
      { label: "月別価格", value: formatPrice(detail.price) },
      { label: "メモ", value: detail.notes || "" }
    ]
  });
}
