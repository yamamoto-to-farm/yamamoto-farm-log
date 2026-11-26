function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function groupDailyEntries(entries) {
  const grouped = new Map();
  for (const entry of entries) {
    const key = entry.shippingDate;
    if (!grouped.has(key)) {
      grouped.set(key, { ...entry });
      continue;
    }
    const current = grouped.get(key);
    current.weight = current.weight === null || entry.weight === null ? null : current.weight + entry.weight;
    current.bins = current.bins === null || entry.bins === null ? null : current.bins + entry.bins;
    current.amount = current.amount === null || entry.amount === null ? null : current.amount + entry.amount;
    if (current.matchStatus !== entry.matchStatus || current.reportNumber !== entry.reportNumber ||
        current.reportDate !== entry.reportDate) {
      throw new Error(`${key}の出荷明細の照合状態が一致しません。`);
    }
  }
  return [...grouped.values()].sort((a, b) => a.shippingDate.localeCompare(b.shippingDate));
}

export function validateLotRefs(entries, normalize) {
  const refs = new Map();
  for (const entry of entries) {
    const raw = String(entry.plantingRef || "").trim();
    if (!raw) continue;
    const key = normalize(raw);
    if (refs.has(key) && refs.get(key) !== raw) {
      throw new Error("異なる作付けが同じロット名に変換されるため、売上を照合できません。");
    }
    refs.set(key, raw);
  }
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
    const weight = String(row.totalWeight ?? "").trim() ? Number(row.totalWeight) : NaN;
    const bins = String(row.bins ?? "").trim() ? Number(row.bins) : NaN;
    const invalid = !Number.isFinite(weight) || weight <= 0 || !String(row.field || "").trim() || !String(row.plantingRef || "").trim();
    if (!shipping.has(date)) shipping.set(date, []);
    shipping.get(date).push({ field: String(row.field || "").trim(), plantingRef: String(row.plantingRef || "").trim(),
      weight: Number.isFinite(weight) && weight > 0 ? weight : null,
      bins: Number.isFinite(bins) && bins >= 0 ? bins : null, invalid });
  }

  const byDate = new Map();
  for (const row of rows) {
    if (!byDate.has(row.shippingDate)) byDate.set(row.shippingDate, []);
    byDate.get(row.shippingDate).push(row);
  }
  const allocations = new Map();
  const daily = [];
  for (const date of new Set([...byDate.keys(), ...shipping.keys()])) {
    const items = byDate.get(date) || [];
    const shipped = shipping.get(date) || [];
    const totalWeight = shipped.reduce((sum, item) => sum + (item.weight || 0), 0);
    const item = items[0];
    let reason = "";
    if (shipped.some(entry => entry.invalid)) reason = "出荷記録の重量・圃場・作付けが不完全";
    else if (!items.length) reason = "対応する通知書が未取得または未対応";
    else if (items.length !== 1) reason = "同じ出荷日の精算明細が複数";
    else if (!item.product.normalize("NFKC").replace(/\s/g, "").includes("鉄コンテナ")) reason = "鉄コンテナ以外";
    else if (Math.abs(item.quantity * item.unitPrice - item.amount) > 1) reason = "数量・単価・販売額が不一致";
    else if (!shipped.length) reason = "出荷記録なし";
    else if (Math.abs(totalWeight - item.quantity) > 0.001) reason = "出荷重量と精算数量が不一致";
    const matchStatus = reason ? (items.length || shipped.some(entry => entry.invalid) ? "要確認" : "通知書未取得") : "照合済み";
    for (const row of items) {
      row.matchStatus = matchStatus;
      row.matchReason = reason;
    }
    for (const entry of shipped) {
      const amount = reason ? null : item.amount * entry.weight / totalWeight;
      daily.push({ ...entry, shippingDate: date, amount, matchStatus, matchReason: reason,
        unitPrice: reason ? null : item.unitPrice,
        reportDate: reason ? null : item.reportDate, reportNumber: reason ? null : item.reportNumber,
        reportAmount: reason ? null : item.amount });
      if (reason) continue;
      const key = JSON.stringify([entry.field, entry.plantingRef]);
      if (!allocations.has(key)) allocations.set(key, {
        field: entry.field, plantingRef: entry.plantingRef, weight: 0, amount: 0,
      });
      const value = allocations.get(key);
      value.weight += entry.weight;
      value.amount += amount;
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
    daily,
    unmatchedShippingDates: [...shipping.keys()].filter(date => !byDate.has(date)).sort(),
  };
}
