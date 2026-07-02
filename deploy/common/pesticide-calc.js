import { distributeByFieldSize } from "/common/field-utils.js?v=1";

export function toNumber(value) {
  const num = Number(String(value ?? "").trim());
  return Number.isFinite(num) ? num : 0;
}

export function calcPer10a(totalWaterAmount, totalA) {
  const water = toNumber(totalWaterAmount);
  const area = toNumber(totalA);
  if (area <= 0) return 0;
  return (water / area) * 10;
}

export function getTotalWaterAmount(usage) {
  // 旧キー total_spray_amount も受け入れて後方互換を保つ
  return toNumber(usage?.total_water_amount ?? usage?.total_spray_amount ?? 0);
}

export async function distributePesticideUsageByField(fields, pesticideUsage) {
  const result = [];

  for (const usage of pesticideUsage || []) {
    const totalWaterAmount = getTotalWaterAmount(usage);
    const distributed = await distributeByFieldSize(fields, totalWaterAmount);

    distributed.forEach(d => {
      result.push({
        field: d.field,
        pesticide_id: usage.pesticide_id,
        name: usage.name,
        dilution_rate: toNumber(usage.dilution_rate),
        unit: usage.unit || "L",
        water_amount: d.amount,
        spray_amount: d.amount
      });
    });
  }

  return result;
}
