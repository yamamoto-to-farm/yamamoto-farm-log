function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function analyzeSales(reports, weights, from, to) {
  if (!validDate(from) || !validDate(to) || from > to) {
    throw new Error("集計期間を正しく指定してください。");
  }
  const rows = [];
  const seen = new Set();
  for (const report of reports) {
    if (!Array.isArray(report.items) || typeof report.date !== "string" ||
        !/^\d{8}$/.test(report.date) || typeof report.number !== "string" ||
        !/^\d{6,12}$/.test(report.number)) {
      throw new Error("精算書データの形式が不正です。");
    }
    const key = `${report.date}_${report.number}`;
    if (seen.has(key)) throw new Error("同じ精算書が重複しています。");
    seen.add(key);
    for (const item of report.items) {
      if (!validDate(item.shippingDate) || !Number.isFinite(item.quantity) ||
          item.quantity <= 0 || !Number.isFinite(item.unitPrice) || item.unitPrice < 0 ||
          !Number.isSafeInteger(item.amount) || item.amount < 0 ||
          typeof item.product !== "string" || !item.product.trim()) {
        throw new Error("精算明細の形式が不正です。");
      }
      if (item.shippingDate >= from && item.shippingDate <= to) {
        rows.push({ ...item, reportDate: report.date, reportNumber: report.number });
      }
    }
  }

  const shipping = new Map();
  for (const row of weights) {
    const date = String(row.shippingDate || "").trim();
    if (!validDate(date)) throw new Error("出荷記録の日付が不正です。");
    if (date < from || date > to) continue;
    const weight = Number(row.totalWeight);
    if (!Number.isFinite(weight) || weight <= 0 || !row.field || !row.plantingRef) {
      throw new Error(`${date}の出荷記録に重量・圃場・作付けの不足があります。`);
    }
    if (!shipping.has(date)) shipping.set(date, []);
    shipping.get(date).push({ field: row.field, plantingRef: row.plantingRef, weight });
  }

  const byDate = new Map();
  for (const row of rows) {
    if (!byDate.has(row.shippingDate)) byDate.set(row.shippingDate, []);
    byDate.get(row.shippingDate).push(row);
  }
  const allocations = new Map();
  for (const [date, items] of byDate) {
    const shipped = shipping.get(date) || [];
    const totalWeight = shipped.reduce((sum, item) => sum + item.weight, 0);
    const item = items[0];
    if (items.length !== 1 || !String(item.product || "").normalize("NFKC").replace(/\s/g, "").includes("鉄コンテナ") ||
        item.quantity <= 0 || item.unitPrice < 0 || item.amount < 0 ||
        Math.abs(item.quantity * item.unitPrice - item.amount) > 1 ||
        !shipped.length || Math.abs(totalWeight - item.quantity) > 0.001) {
      for (const row of items) row.matchStatus = "要確認";
      continue;
    }
    item.matchStatus = "照合済み";
    for (const entry of shipped) {
      const key = JSON.stringify([entry.field, entry.plantingRef]);
      if (!allocations.has(key)) allocations.set(key, {
        field: entry.field, plantingRef: entry.plantingRef, weight: 0, amount: 0,
      });
      const value = allocations.get(key);
      value.weight += entry.weight;
      value.amount += item.amount * entry.weight / totalWeight;
    }
  }
  const monthly = new Map();
  for (const row of rows) {
    const month = row.shippingDate.slice(0, 7);
    const key = JSON.stringify([month, row.product]);
    const value = monthly.get(key) || { month, product: row.product, amount: 0, quantity: 0 };
    value.amount += row.amount;
    value.quantity += row.quantity;
    monthly.set(key, value);
  }
  return {
    rows,
    monthly: [...monthly.values()].sort((a, b) => a.month.localeCompare(b.month)),
    allocations: [...allocations.values()].sort((a, b) =>
      a.field.localeCompare(b.field, "ja") || a.plantingRef.localeCompare(b.plantingRef, "ja")),
    unmatchedShippingDates: [...shipping.keys()].filter(date => !byDate.has(date)).sort(),
  };
}
