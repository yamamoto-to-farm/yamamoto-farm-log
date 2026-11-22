function number(text) {
  const value = String(text).normalize("NFKC").trim();
  if (!/^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(value)) {
    throw new Error("精算書の数量・金額の形式を確認できません。");
  }
  const result = Number(value.replaceAll(",", ""));
  if (!Number.isFinite(result)) throw new Error("精算書の数値が不正です。");
  return result;
}

function date(text) {
  const value = String(text).normalize("NFKC").trim().replaceAll("/", "-");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("出荷日を確認できません。");
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error("出荷日が不正です。");
  }
  return value;
}

export function parseSales({ product, rows, totalQuantity, totalAmount, tax }) {
  if (typeof product !== "string" || !product.trim() || !Array.isArray(rows) || !rows.length) {
    throw new Error("精算書の品名・販売明細を確認できません。");
  }
  const items = rows.map(row => {
    if (!Array.isArray(row) || row.length !== 7) throw new Error("販売明細の形式が変わりました。");
    const quantity = number(row[3]);
    const unitPrice = number(row[4]);
    const amount = number(row[5]);
    if (quantity <= 0 || !Number.isSafeInteger(amount) || Math.abs(quantity * unitPrice - amount) > 1) {
      throw new Error("販売明細の数量・単価・金額が一致しません。減額通知等は未対応です。");
    }
    return { shippingDate: date(row[0]), quantity, unitPrice, amount, product: product.trim() };
  });
  const sumQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const sumAmount = items.reduce((sum, item) => sum + item.amount, 0);
  const parsedTax = number(tax);
  if (Math.abs(sumQuantity - number(totalQuantity)) > 0.001 ||
      sumAmount !== number(totalAmount) || !Number.isSafeInteger(parsedTax)) {
    throw new Error("販売明細と通知書の合計が一致しません。");
  }
  return { items, tax: parsedTax };
}
