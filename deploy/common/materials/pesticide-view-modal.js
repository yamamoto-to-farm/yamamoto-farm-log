import { openInfoModal } from "./modal-base.js?v=1";

function formatLatestPrice(price) {
  if (!price || typeof price !== "object" || Array.isArray(price)) return "";
  const entries = Object.entries(price)
    .filter(([month]) => /^\d{4}-\d{2}$/.test(String(month || "").trim()));
  if (entries.length === 0) return "";
  entries.sort((a, b) => String(a[0]).localeCompare(String(b[0]), "ja"));
  const [month, value] = entries[entries.length - 1];
  return `${month}: ${value}`;
}

function formatDilution(dilution) {
  if (!dilution || typeof dilution !== "object") return "";
  const min = dilution?.min;
  const max = dilution?.max;
  const def = dilution?.default;

  const hasMin = min != null && min !== "";
  const hasMax = max != null && max !== "";
  const hasDef = def != null && def !== "";

  if (!hasMin && !hasMax && !hasDef) return "";

  const range = hasMin || hasMax
    ? `${hasMin ? min : "-"} - ${hasMax ? max : "-"} 倍`
    : "";
  const standard = hasDef ? `${def} 倍` : "";

  if (standard && range) return `標準: ${standard}\n範囲: ${range}`;
  if (standard) return `標準: ${standard}`;
  return `範囲: ${range}`;
}

function formatNullableNumber(value, unit = "") {
  if (value == null || value === "") return "";
  return `${value}${unit}`;
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
      { label: "希釈情報", value: formatDilution(detail.dilution) },
      { label: "使用回数上限", value: formatNullableNumber(detail.maxApplicationsPerSeason, " 回") },
      { label: "収穫前日数", value: formatNullableNumber(detail.preHarvestIntervalDays, " 日") },
      { label: "抵抗性コード", value: detail.resistanceCode || "" },
      { label: "有効成分", value: formatArray(ingredients) },
      { label: "対象作物", value: formatArray(crops) },
      { label: "対象病害虫/雑草", value: formatArray(pests) },
      { label: "月別価格（最新）", value: formatLatestPrice(detail.price) },
      { label: "メモ", value: detail.notes || "" }
    ]
  });
}
