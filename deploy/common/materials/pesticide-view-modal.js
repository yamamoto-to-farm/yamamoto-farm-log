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

export function openPesticideInfoModal(detail = {}) {
  const title = `${detail.name || "農薬"} (${detail.id || "ID不明"})`;

  openInfoModal({
    title,
    rows: [
      { label: "カテゴリ", value: detail.category || "" },
      { label: "メーカー", value: detail.maker || "" },
      { label: "単位", value: detail.unit || "" },
      { label: "登録番号", value: detail.registrationNo || detail.registration?.number || "" },
      { label: "剤型", value: detail.formulation || detail.registration?.formulation || "" },
      { label: "抵抗性コード", value: detail.resistanceCode || "" },
      { label: "有効成分", value: formatArray(detail.activeIngredients) },
      { label: "対象作物", value: formatArray(detail.targetCrops) },
      { label: "対象病害虫/雑草", value: formatArray(detail.targetPests) },
      { label: "月別価格", value: formatPrice(detail.price) },
      { label: "メモ", value: detail.notes || "" }
    ]
  });
}
