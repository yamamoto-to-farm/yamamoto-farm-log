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
    const dilutionRate = toNumber(usage.dilution_rate);
    const pesticideUnit = usage.pesticide_unit || "ml";
    const distributed = await distributeByFieldSize(fields, totalWaterAmount);

    distributed.forEach(d => {
      const chemicalL = dilutionRate > 0 ? d.amount / dilutionRate : 0;
      const chemicalAmount = convertLiterToUnit(chemicalL, pesticideUnit);

      result.push({
        field: d.field,
        pesticide_id: usage.pesticide_id,
        name: usage.name,
        dilution_rate: dilutionRate,
        unit: "L",
        water_unit: "L",
        water_amount: d.amount,
        spray_amount: d.amount,
        pesticide_amount: chemicalAmount,
        pesticide_unit: pesticideUnit
      });
    });
  }

  return result;
}

function convertLiterToUnit(amountL, unit) {
  const u = String(unit || "").toLowerCase();
  if (u === "ml" || u === "cc") return amountL * 1000;
  return amountL;
}
